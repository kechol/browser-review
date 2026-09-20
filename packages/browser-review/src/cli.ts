// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { OpenResult, SessionMode } from "@browser-review/shared";
import { feedUrl, formatStatus, mcpUrl, reviewUrl } from "./format.js";
import { logPath } from "./paths.js";
import {
  ensureDirs,
  isSessionActive,
  listSessionFiles,
  readSessionFile,
  resolveSession,
  sweepStaleSessions,
} from "./store.js";
import { ulid } from "./ulid.js";

const SELF = fileURLToPath(import.meta.url);
const STARTUP_TIMEOUT_MS = 15_000;

const USAGE = `browser-review — point at an element in your browser, let an agent fix the code.

Usage:
  browser-review open <file.html | http://localhost:PORT/...> [options]
  browser-review status [--session <id>] [--json]
  browser-review close [--session <id|latest>]
  browser-review mcp [--session <id|latest>]

Options:
  --port <n>            Port to listen on. 0 (the default) picks a free one.
  --project-dir <dir>   Repository the agent may edit. Defaults to
                        $CLAUDE_PROJECT_DIR, then the working directory.
  --json                Print one line of JSON instead of prose.
  --session <id>        Which session to act on. "latest" means the newest
                        running one.
  -h, --help            Show this message.

The server binds to 127.0.0.1 only and makes no outbound network requests.
`;

function fail(message: string): never {
  process.stderr.write(`browser-review: ${message}\n`);
  process.exit(1);
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
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
 * Work out what is being reviewed, and refuse anything that is not on this
 * machine. Injecting an overlay into a site we do not control would mean
 * proxying someone else's origin, which is neither ours to do nor safe.
 */
export function parseTarget(raw: string, cwd: string): ParsedTarget {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new TargetError(`"${raw}" is not a URL this tool can open.`);
    }
    if (url.protocol !== "http:") {
      throw new TargetError(
        `only http:// URLs are supported (got "${url.protocol}//"). ` +
          "A local dev server is served over http.",
      );
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
      throw new TargetError(
        `"${url.hostname}" is not a local host. browser-review only proxies ` +
          "http://localhost and http://127.0.0.1, because injecting a review overlay into " +
          "a site you do not run is neither safe nor yours to do. To review a deployed page, " +
          "run it locally first.",
      );
    }
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
      `${resolved} is not an HTML file. Pass an .html file, or a http://localhost URL.`,
    );
  }
  return { mode: "html-file", target: resolved };
}

function projectDirFrom(explicit: string | undefined, cwd: string): string {
  const candidate = explicit ?? process.env["CLAUDE_PROJECT_DIR"] ?? cwd;
  return path.resolve(candidate);
}

async function cmdOpen(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "project-dir": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const raw = positionals[0];
  if (!raw) fail("open needs a target: an .html file or a http://localhost URL.");

  const cwd = process.cwd();
  let parsed: ParsedTarget;
  try {
    parsed = parseTarget(raw, cwd);
  } catch (err) {
    if (err instanceof TargetError) fail(err.message);
    throw err;
  }
  const { mode, target, entryPath } = parsed;
  const projectDir = projectDirFrom(values["project-dir"], cwd);
  const port = Number(values["port"] ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) fail(`invalid port: ${values["port"]}`);

  await ensureDirs();
  await sweepStaleSessions();

  const id = ulid();
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
      "--token",
      token,
      "--mode",
      mode,
      "--target",
      target,
      "--project-dir",
      projectDir,
      "--port",
      String(port),
      ...(entryPath ? ["--entry-path", entryPath] : []),
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    const file = await readSessionFile(id);
    if (file) {
      const result: OpenResult = {
        sessionId: file.session.id,
        token: file.session.token,
        reviewUrl: reviewUrl(file.session),
        handoffMcpUrl: mcpUrl(file.session),
        handoffFeedUrl: feedUrl(file.session),
        mode: file.session.mode,
        target: file.session.target,
        projectDir: file.session.projectDir,
        port: file.session.port,
        pid: file.session.pid,
      };
      if (values["json"]) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(
          [
            `Review session ${result.sessionId} (${result.mode}) is up.`,
            ``,
            `  Open in a browser: ${result.reviewUrl}`,
            `  Hand off to another agent: ${result.handoffMcpUrl}`,
            `  Reviewing: ${result.target}`,
            `  Agent may edit: ${result.projectDir}`,
            ``,
            `Stop it with: browser-review close --session ${result.sessionId}`,
            ``,
          ].join("\n"),
        );
      }
      return;
    }
    if (Date.now() > deadline) {
      const tail = await fsp.readFile(log, "utf8").catch(() => "");
      fail(
        `the review server did not start within ${STARTUP_TIMEOUT_MS / 1000}s.\n` +
          (tail ? `Server log:\n${tail}` : `See ${log}`),
      );
    }
    await delay(50);
  }
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
    ...(entryPath ? { entryPath } : {}),
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
  const counts = file.annotations.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
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
    counts: {
      pending: counts["pending"] ?? 0,
      acknowledged: counts["acknowledged"] ?? 0,
      resolved: counts["resolved"] ?? 0,
      dismissed: counts["dismissed"] ?? 0,
    },
  };
}

async function cmdClose(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { session: { type: "string" } } });
  const file = await resolveSession(values["session"] ?? "latest");
  if (!file) {
    process.stdout.write("No running review session to close.\n");
    return;
  }
  try {
    process.kill(file.session.pid, "SIGTERM");
  } catch {
    // Already gone; the file still needs closing out.
  }
  const { updateSessionFile } = await import("./store.js");
  await updateSessionFile(file.session.id, (current) => {
    current.session.closedAt = new Date().toISOString();
  }).catch(() => undefined);
  process.stdout.write(`Closed review session ${file.session.id}.\n`);
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
  const screenshot = async (selector?: string) => {
    const file = await resolve();
    if (!file) return null;
    const capture = await createScreenshotter(file.session);
    return capture ? capture(selector) : null;
  };
  const server = createMcpServer({ resolveSession: resolve, delivery, screenshot });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    void delivery.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
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
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    fail((err as Error).stack ?? String(err));
  });
}
