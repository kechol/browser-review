// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { OpenResult, Session, SessionFile, SessionMode } from "@browser-review/shared";
import { countByStatus, feedUrl, formatStatus, mcpUrl, reviewUrl } from "./format.js";
import { logPath } from "./paths.js";
import {
  ensureDirs,
  isProcessAlive,
  isSessionActive,
  listSessionFiles,
  projectSessions,
  readSessionFile,
  resolveSession,
  resolveSessions,
  sweepStaleSessions,
  updateSessionFile,
} from "./store.js";
import { ulid } from "./ulid.js";
import { UpstreamError, validateProxyTarget } from "./upstream.js";
import {
  isTrustedTarget,
  readTrustedOrigins,
  TrustedOriginsError,
  updateTrustedOrigin,
} from "./trust.js";

const SELF = fileURLToPath(import.meta.url);
const STARTUP_TIMEOUT_MS = 15_000;

const USAGE = `browser-review — point at an element in your browser, let an agent fix the code.

Usage:
  browser-review open <file.html | URL>... [options]
  browser-review status [--session <id>] [--json]
  browser-review close [<file.html | URL>... | --session <id[,id...]|latest> | --project]
  browser-review mcp [--session <id[,id...]|latest|project>]
  browser-review trust add <https-origin>
  browser-review trust list
  browser-review trust remove <https-origin>

Options:
  --port <n>            Port to listen on. 0 (the default) picks a free one.
  --project-dir <dir>   Repository the agent may edit. Defaults to
                        $CLAUDE_PROJECT_DIR, then the working directory.
  --allow-remote        Explicitly allow one trusted HTTPS staging origin.
  --cookie-file <path>  Import a Netscape cookie jar for one HTTPS session.
  --ca-file <path>      Trust this PEM CA bundle for one HTTPS session.
  --json                Print one line of JSON per target instead of prose.
  --project             close: every running session of this project.
  --session <id>        Which session to act on. "latest" means the newest
                        running one. For mcp, "project" means every running
                        session of this project, and several ids may be
                        separated by commas.
  -h, --help            Show this message.

Opening a target this project already has a running session for returns that
session; opening one whose session was closed reopens it with its comments.
--port, --cookie-file and --ca-file apply to a single target only.

The server always binds to 127.0.0.1. Remote proxying is off by default.
`;

function fail(message: string): never {
  process.stderr.write(`browser-review: ${message}\n`);
  process.exit(1);
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function isUrlTarget(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
}

function stopProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/**
 * Wait until a stopped server has exited, so that its own shutdown write has
 * landed before the caller goes on. Gives up after `timeoutMs`.
 */
async function waitForExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) await delay(25);
}

/** A problem with what the user asked for, as opposed to a crash. */
export class TargetError extends Error {}

interface ParsedTarget {
  mode: SessionMode;
  target: string;
  /** Path the review URL should open on, for a URL that named more than the root. */
  entryPath?: string;
}

/**
 * Work out what is being reviewed. Remote proxying remains denied unless the
 * caller explicitly opts in; the server independently repeats this check and
 * pins the hostname before it starts listening.
 */
export function parseTarget(
  raw: string,
  cwd: string,
  options: { allowRemote?: boolean } = {},
): ParsedTarget {
  if (isUrlTarget(raw)) {
    let validated: ReturnType<typeof validateProxyTarget>;
    try {
      validated = validateProxyTarget(raw, options.allowRemote);
    } catch (err) {
      if (err instanceof UpstreamError) throw new TargetError(err.message);
      throw err;
    }
    const { url } = validated;
    const entryPath =
      url.pathname === "/" && !url.search && !url.hash ? "" : url.pathname + url.search + url.hash;
    return entryPath
      ? { mode: "proxy", target: url.origin, entryPath }
      : { mode: "proxy", target: url.origin };
  }

  const resolved = path.resolve(cwd, raw);
  if (!fs.existsSync(resolved)) throw new TargetError(`no such file: ${resolved}`);
  if (!fs.statSync(resolved).isFile()) throw new TargetError(`${resolved} is not a file.`);
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".html" && ext !== ".htm") {
    throw new TargetError(
      `${resolved} is not an HTML file. Pass an .html file or a supported proxy URL.`,
    );
  }
  return { mode: "html-file", target: resolved };
}

function projectDirFrom(explicit: string | undefined, cwd: string): string {
  const candidate = explicit ?? process.env["CLAUDE_PROJECT_DIR"] ?? cwd;
  return path.resolve(candidate);
}

/**
 * What makes two opens the same target: the real path of an HTML file, or the
 * origin of a proxy target, so that two entry paths into one application share
 * a session.
 */
function targetKey(mode: SessionMode, target: string): string {
  if (mode === "proxy") return `proxy:${target}`;
  try {
    return `file:${fs.realpathSync(target)}`;
  } catch {
    return `file:${path.resolve(target)}`;
  }
}

function sessionKey(session: Session): string {
  return targetKey(session.mode, session.target);
}

interface OpenRequest extends ParsedTarget {
  raw: string;
  allowRemote: boolean;
  key: string;
}

async function prepareTarget(
  raw: string,
  cwd: string,
  explicitAllowRemote: boolean,
): Promise<OpenRequest> {
  let allowRemote = explicitAllowRemote;
  if (!allowRemote && isUrlTarget(raw)) {
    let local = false;
    try {
      local = !validateProxyTarget(raw).remote;
    } catch {
      // A remote target may still be present in the explicit trust file.
    }
    if (!local) {
      try {
        allowRemote = await isTrustedTarget(raw);
      } catch (error) {
        if (error instanceof TrustedOriginsError) fail(error.message);
        throw error;
      }
    }
  }
  let parsed: ParsedTarget;
  try {
    parsed = parseTarget(raw, cwd, { allowRemote });
  } catch (err) {
    if (err instanceof TargetError) fail(`${raw}: ${err.message}`);
    throw err;
  }
  return { ...parsed, raw, allowRemote, key: targetKey(parsed.mode, parsed.target) };
}

interface ServeOptions {
  projectDir: string;
  port: number;
  cookieFile?: string;
  caFile?: string;
}

/**
 * Start a detached review server and wait until it has written its session
 * file. A resumed session already has a file, so readiness is the new token
 * appearing in it rather than the file existing.
 */
async function startServer(
  id: string,
  request: OpenRequest,
  options: ServeOptions,
  resume: boolean,
): Promise<{ file: SessionFile; pid: number | undefined }> {
  const token = newToken();
  const log = logPath(id);
  await fsp.mkdir(path.dirname(log), { recursive: true, mode: 0o700 });
  const logFd = fs.openSync(log, "a", 0o600);

  const child = spawn(
    process.execPath,
    [
      SELF,
      "__serve",
      "--id",
      id,
      `--token=${token}`,
      "--mode",
      request.mode,
      "--target",
      request.target,
      "--project-dir",
      options.projectDir,
      "--port",
      String(options.port),
      ...(request.entryPath ? ["--entry-path", request.entryPath] : []),
      ...(request.allowRemote ? ["--allow-remote"] : []),
      ...(options.cookieFile ? ["--cookie-file", options.cookieFile] : []),
      ...(options.caFile ? ["--ca-file", options.caFile] : []),
      ...(resume ? ["--resume"] : []),
    ],
    { detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true },
  );
  let childExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
  });
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    const file = await readSessionFile(id).catch(() => null);
    if (file?.session.token === token) return { file, pid: child.pid };
    if (childExit || Date.now() > deadline) {
      const tail = await fsp.readFile(log, "utf8").catch(() => "");
      const reason = childExit
        ? `the review server for ${request.raw} exited before startup (${JSON.stringify(childExit)}).`
        : `the review server for ${request.raw} did not start within ${STARTUP_TIMEOUT_MS / 1000}s.`;
      throw new TargetError(`${reason}\n${tail ? `Server log:\n${tail}` : `See ${log}`}`);
    }
    await delay(50);
  }
}

async function cmdOpen(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "project-dir": { type: "string" },
      "allow-remote": { type: "boolean", default: false },
      "cookie-file": { type: "string" },
      "ca-file": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length === 0) fail("open needs a target: an .html file or a proxy URL.");
  if (positionals.length > 1) {
    for (const option of ["port", "cookie-file", "ca-file"] as const) {
      if (values[option] !== undefined) {
        fail(`--${option} applies to a single target. Open the target that needs it on its own.`);
      }
    }
  }

  const cwd = process.cwd();
  const requests: OpenRequest[] = [];
  for (const raw of positionals) {
    requests.push(await prepareTarget(raw, cwd, values["allow-remote"]));
  }
  // Credential files are only accepted with a single target, checked above.
  const first = requests[0]!;
  const secureProxy = first.mode === "proxy" && new URL(first.target).protocol === "https:";
  for (const option of ["cookie-file", "ca-file"] as const) {
    if (values[option] && !secureProxy) fail(`--${option} requires an HTTPS proxy target.`);
  }
  const cookieFile = values["cookie-file"] ? path.resolve(cwd, values["cookie-file"]) : undefined;
  const caFile = values["ca-file"] ? path.resolve(cwd, values["ca-file"]) : undefined;
  const projectDir = projectDirFrom(values["project-dir"], cwd);
  const port = Number(values["port"] ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) fail(`invalid port: ${values["port"]}`);

  await ensureDirs();
  await sweepStaleSessions();

  // Decide everything before starting anything, so a rejected target leaves
  // no half-opened set behind.
  interface Plan {
    request: OpenRequest;
    state: OpenResult["state"];
    id: string;
    running?: SessionFile;
  }
  const known = await projectSessions(projectDir);
  const plans = new Map<string, Plan>();
  const conflicts: string[] = [];
  for (const request of requests) {
    if (plans.has(request.key)) continue;
    const same = known.filter((file) => sessionKey(file.session) === request.key);
    const running = same.find((file) => isSessionActive(file.session));
    if (running) {
      const differences = [
        ...(!!cookieFile !== !!running.session.cookieFile ? ["--cookie-file"] : []),
        ...(!!caFile !== !!running.session.caFile ? ["--ca-file"] : []),
        ...(port !== 0 && port !== running.session.port ? ["--port"] : []),
      ];
      if (differences.length > 0) {
        conflicts.push(
          `${request.raw}: session ${running.session.id} is already running for this target ` +
            `with different ${differences.join(", ")}. Close it first with: ` +
            `browser-review close --session ${running.session.id}`,
        );
      }
      plans.set(request.key, { request, state: "running", id: running.session.id, running });
    } else if (same[0]) {
      plans.set(request.key, { request, state: "reopened", id: same[0].session.id });
    } else {
      plans.set(request.key, { request, state: "started", id: ulid() });
    }
  }
  if (conflicts.length > 0) fail(conflicts.join("\n"));

  const files = new Map<string, SessionFile>();
  const toStart: Plan[] = [];
  for (const [key, plan] of plans) {
    if (plan.running) files.set(key, plan.running);
    else toStart.push(plan);
  }
  const serveOptions: ServeOptions = {
    projectDir,
    port,
    ...(cookieFile ? { cookieFile } : {}),
    ...(caFile ? { caFile } : {}),
  };
  const outcomes = await Promise.allSettled(
    toStart.map((plan) =>
      startServer(plan.id, plan.request, serveOptions, plan.state === "reopened"),
    ),
  );
  const failures: unknown[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") files.set(toStart[index]!.request.key, outcome.value.file);
    else failures.push(outcome.reason);
  });
  if (failures.length > 0) {
    // The servers started by this call close their own sessions on SIGTERM.
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled" && outcome.value.pid) stopProcess(outcome.value.pid);
    }
    const unexpected = failures.find((failure) => !(failure instanceof TargetError));
    if (unexpected) throw unexpected;
    fail(failures.map((failure) => (failure as TargetError).message).join("\n"));
  }

  const results = requests.map((request) => {
    const plan = plans.get(request.key)!;
    const file = files.get(request.key)!;
    const { entryPath: _entryPath, ...session } = file.session;
    // The URL lands where this request asked, even on a session opened from another entry path.
    const landing: Session = request.entryPath
      ? { ...session, entryPath: request.entryPath }
      : session;
    const result: OpenResult = {
      state: plan.state,
      sessionId: session.id,
      token: session.token,
      reviewUrl: reviewUrl(landing),
      handoffMcpUrl: mcpUrl(session),
      handoffFeedUrl: feedUrl(session),
      mode: session.mode,
      target: session.target,
      projectDir: session.projectDir,
      port: session.port,
      pid: session.pid,
    };
    return { result, file };
  });

  if (values["json"]) {
    process.stdout.write(results.map(({ result }) => `${JSON.stringify(result)}\n`).join(""));
    return;
  }
  const blocks = results.map(({ result, file }) => {
    const counts = countByStatus(file.annotations);
    const outcome = {
      started: "is up.",
      running: "was already running.",
      reopened:
        `was reopened with its comments ` +
        `(pending ${counts.pending}, acknowledged ${counts.acknowledged}).`,
    }[result.state];
    return [
      `Review session ${result.sessionId} (${result.mode}) ${outcome}`,
      ``,
      `  Open in a browser: ${result.reviewUrl}`,
      `  Hand off to another agent: ${result.handoffMcpUrl}`,
      `  Reviewing: ${result.target}`,
      `  Agent may edit: ${result.projectDir}`,
      ``,
      `Stop it with: browser-review close --session ${result.sessionId}`,
      ``,
    ].join("\n");
  });
  process.stdout.write(blocks.join("\n"));
}

async function cmdServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      id: { type: "string" },
      token: { type: "string" },
      mode: { type: "string" },
      target: { type: "string" },
      "project-dir": { type: "string" },
      port: { type: "string" },
      "entry-path": { type: "string" },
      "allow-remote": { type: "boolean", default: false },
      "cookie-file": { type: "string" },
      "ca-file": { type: "string" },
      resume: { type: "boolean", default: false },
    },
  });
  const { startReviewServer } = await import("./server.js");
  const entryPath = values["entry-path"];
  const running = await startReviewServer({
    id: String(values["id"]),
    token: String(values["token"]),
    mode: values["mode"] === "proxy" ? "proxy" : "html-file",
    target: String(values["target"]),
    projectDir: String(values["project-dir"]),
    port: Number(values["port"] ?? 0),
    allowRemote: values["allow-remote"],
    ...(values["cookie-file"] ? { cookieFile: values["cookie-file"] } : {}),
    ...(values["ca-file"] ? { caFile: values["ca-file"] } : {}),
    ...(entryPath ? { entryPath } : {}),
    resume: values["resume"],
  });
  const shutdown = () => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.stderr.write(`browser-review: serving session ${running.session.id}\n`);
}

async function cmdStatus(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { session: { type: "string" }, json: { type: "boolean", default: false } },
  });

  if (values["session"]) {
    const file = await resolveSession(values["session"]);
    if (!file) {
      if (values["json"]) process.stdout.write(`${JSON.stringify({ sessions: [] })}\n`);
      else process.stdout.write("No such session.\n");
      process.exitCode = 1;
      return;
    }
    if (values["json"]) process.stdout.write(`${JSON.stringify(summarize(file))}\n`);
    else process.stdout.write(`${formatStatus(file)}\n`);
    return;
  }

  const files = await listSessionFiles();
  const active = files.filter((f) => isSessionActive(f.session));
  if (values["json"]) {
    process.stdout.write(`${JSON.stringify({ sessions: active.map(summarize) })}\n`);
    return;
  }
  if (active.length === 0) {
    process.stdout.write(
      "No review session is running. Start one with: browser-review open <target>\n",
    );
    return;
  }
  process.stdout.write(`${active.map(formatStatus).join("\n\n")}\n`);
}

function summarize(file: Awaited<ReturnType<typeof readSessionFile>>) {
  if (!file) return null;
  return {
    sessionId: file.session.id,
    mode: file.session.mode,
    target: file.session.target,
    projectDir: file.session.projectDir,
    port: file.session.port,
    pid: file.session.pid,
    active: isSessionActive(file.session),
    reviewUrl: reviewUrl(file.session),
    handoffMcpUrl: mcpUrl(file.session),
    handoffFeedUrl: feedUrl(file.session),
    counts: countByStatus(file.annotations),
  };
}

/** Like `targetKey`, for a target that may no longer exist or be trusted. */
function closeKey(raw: string, cwd: string): string {
  if (isUrlTarget(raw)) {
    try {
      return targetKey("proxy", new URL(raw).origin);
    } catch {
      fail(`not a valid URL: ${raw}`);
    }
  }
  return targetKey("html-file", path.resolve(cwd, raw));
}

async function cmdClose(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: "string" },
      project: { type: "boolean", default: false },
      "project-dir": { type: "string" },
    },
  });
  const selectors = [values["session"] !== undefined, values["project"], positionals.length > 0];
  if (selectors.filter(Boolean).length > 1) {
    fail("close takes targets, --session, or --project, not more than one of them.");
  }
  const cwd = process.cwd();
  const projectDir = projectDirFrom(values["project-dir"], cwd);
  const running = (files: SessionFile[]) => files.filter((file) => isSessionActive(file.session));

  let targets: SessionFile[];
  if (values["session"] !== undefined) {
    targets = running(await resolveSessions(values["session"], { projectDir }));
  } else {
    const sessions = running(await projectSessions(projectDir));
    targets = positionals.length > 0 ? [] : sessions;
    for (const raw of positionals) {
      const key = closeKey(raw, cwd);
      const match = sessions.find((file) => sessionKey(file.session) === key);
      if (match) targets.push(match);
      else process.stdout.write(`No running review session for ${raw}.\n`);
    }
    if (positionals.length === 0 && !values["project"] && targets.length > 1) {
      process.stdout.write(
        [
          `${targets.length} review sessions are running for this project; nothing was closed.`,
          ...targets.map((file) => `  ${file.session.id}  ${file.session.target}`),
          "",
          "Close one with: browser-review close <file|URL>  (or --session <id>)",
          "Close all of them with: browser-review close --project",
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }
  }
  if (targets.length === 0) {
    if (positionals.length === 0) process.stdout.write("No running review session to close.\n");
    return;
  }

  for (const file of targets) stopProcess(file.session.pid);
  await Promise.all(targets.map((file) => waitForExit(file.session.pid)));
  for (const file of targets) {
    // Marked closed here too, in case the server died without doing it. A
    // token that changed means the session was reopened meanwhile.
    await updateSessionFile(file.session.id, (current) => {
      if (current.session.token !== file.session.token) return;
      current.session.closedAt ??= new Date().toISOString();
    }).catch(() => undefined);
    const { pending, acknowledged } = countByStatus(file.annotations);
    const unresolved = pending + acknowledged;
    const left =
      unresolved > 0
        ? ` ${unresolved} comment${unresolved === 1 ? " was" : "s were"} not resolved ` +
          `(pending ${pending}, acknowledged ${acknowledged}); reopening the target brings ` +
          `them back.`
        : "";
    process.stdout.write(
      `Closed review session ${file.session.id} (${file.session.target}).${left}\n`,
    );
  }
}

async function cmdMcp(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { session: { type: "string" } } });
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createMcpServer, sessionContextFor } = await import("./mcp.js");
  const { PollDelivery } = await import("./delivery/poll.js");

  const { createScreenshotter } = await import("./screenshot.js");

  await ensureDirs();
  const delivery = new PollDelivery();
  const resolve = sessionContextFor(values["session"] ?? "latest");
  // The screenshot backend needs a session to point a browser at, and this
  // process may well start before one exists, so it is built per call.
  const screenshot = async (session: Session, selector?: string) => {
    const capture = await createScreenshotter(session);
    return capture ? capture(selector) : null;
  };
  const server = createMcpServer({ resolveSessions: resolve, delivery, screenshot });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    void delivery.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function cmdTrust(argv: string[]): Promise<void> {
  const [action, origin, ...extra] = argv;
  if (extra.length > 0) fail("trust accepts only an action and one HTTPS origin.");
  try {
    if (action === "list") {
      if (origin) fail("trust list does not accept an origin.");
      const origins = await readTrustedOrigins();
      process.stdout.write(origins.length ? `${origins.join("\n")}\n` : "No trusted origins.\n");
      return;
    }
    if ((action === "add" || action === "remove") && origin) {
      const result = await updateTrustedOrigin(action, origin);
      process.stdout.write(
        `${action === "add" ? "Trusted" : "Removed"} ${result.origin}${result.changed ? "" : " (unchanged)"}.\n`,
      );
      return;
    }
  } catch (error) {
    if (error instanceof TrustedOriginsError) fail(error.message);
    throw error;
  }
  fail("trust needs: add <https-origin>, list, or remove <https-origin>.");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "open":
      return cmdOpen(rest);
    case "__serve":
      return cmdServe(rest);
    case "status":
      return cmdStatus(rest);
    case "close":
      return cmdClose(rest);
    case "mcp":
      return cmdMcp(rest);
    case "trust":
      return cmdTrust(rest);
    case "-h":
    case "--help":
    case "help":
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`${USAGE}\n`);
      fail(`unknown command "${command}".`);
  }
}

/**
 * Only run when this file is what was executed. The tests import `parseTarget`
 * from here, and a module that starts parsing argv on import would print usage
 * into the middle of a test run.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(SELF) === fs.realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    fail((err as Error).stack ?? String(err));
  });
}
