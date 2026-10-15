// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenResult } from "@browser-review/shared";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let state: string;

beforeEach(() => {
  state = fs.mkdtempSync(path.join(os.tmpdir(), "browser-review-cli-integration-"));
});

afterEach(() => {
  fs.rmSync(state, { recursive: true, force: true });
});

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: state },
  });
}

function rejected(...args: string[]): string {
  try {
    run(...args);
    throw new Error("command unexpectedly succeeded");
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
}

describe("trust CLI", () => {
  it("round-trips exact origins and applies removal only to later opens", () => {
    expect(run("trust", "add", "https://Example.COM:443/")).toContain(
      "Trusted https://example.com",
    );
    expect(run("trust", "add", "https://example.com")).toContain("unchanged");
    expect(run("trust", "list")).toBe("https://example.com\n");
    expect(run("trust", "remove", "https://example.com")).toContain("Removed https://example.com");
    expect(run("trust", "list")).toBe("No trusted origins.\n");
    expect(rejected("open", "https://example.com", "--json")).toContain("--allow-remote");

    const origin = "https://192.0.2.10:4443";
    run("trust", "add", origin);
    const opened = JSON.parse(run("open", origin, "--json")) as { sessionId: string };
    try {
      run("trust", "remove", origin);
      expect(run("status", "--session", opened.sessionId, "--json")).toContain('"active":true');
    } finally {
      run("close", "--session", opened.sessionId);
    }
    expect(rejected("open", origin, "--json")).toContain("--allow-remote");
  });

  it("never lets trust bypass the unsafe-address policy", () => {
    run("trust", "add", "https://127.0.0.2");
    const message = rejected("open", "https://127.0.0.2", "--json");
    expect(message).toContain("loopback");
    expect(message).not.toContain("did not start within");
  });

  it("fails closed when the configuration is corrupt", () => {
    const root = path.join(state, "browser-review");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "trusted-origins.json"), "{bad-json");
    expect(rejected("trust", "list")).toContain("configuration is invalid");
  });
});

describe("credential option rejection", () => {
  it("rejects Cookie and CA files for HTTP before reading them", () => {
    const secret = path.join(state, "do-not-read.txt");
    fs.writeFileSync(secret, "synthetic-secret");
    expect(rejected("open", "http://localhost:65534", "--cookie-file", secret)).toContain(
      "requires an HTTPS proxy target",
    );
    expect(rejected("open", "http://localhost:65534", "--ca-file", secret)).toContain(
      "requires an HTTPS proxy target",
    );
  });

  it("reports malformed credential files promptly without echoing their contents", () => {
    const cookieSecret = "synthetic-cookie-secret-never-log";
    const cookieFile = path.join(state, "invalid-cookies.txt");
    fs.writeFileSync(cookieFile, `localhost\tFALSE\t/\tTRUE\t0\tbroken-${cookieSecret}\n`);
    const cookieError = rejected(
      "open",
      "https://localhost:65534",
      "--cookie-file",
      cookieFile,
      "--json",
    );
    expect(cookieError).toContain("invalid Netscape cookie record");
    expect(cookieError).not.toContain(cookieSecret);
    expect(cookieError).not.toContain("did not start within");

    const caSecret = "synthetic-ca-secret-never-log";
    const caFile = path.join(state, "invalid-ca.pem");
    fs.writeFileSync(caFile, caSecret);
    const caError = rejected("open", "https://localhost:65534", "--ca-file", caFile, "--json");
    expect(caError).toContain("valid PEM certificate bundle");
    expect(caError).not.toContain(caSecret);
    expect(caError).not.toContain("did not start within");
  });
});

describe("several targets per project", () => {
  let project: string;
  let upstream: http.Server | undefined;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "browser-review-cli-project-"));
    for (const name of ["a.html", "b.html"]) {
      fs.writeFileSync(path.join(project, name), `<!doctype html><p>${name}</p>`);
    }
  });

  afterEach(async () => {
    inProject("close", "--project");
    if (upstream) await new Promise<void>((resolve) => upstream!.close(() => resolve()));
    upstream = undefined;
    fs.rmSync(project, { recursive: true, force: true });
  });

  function inProject(...args: string[]): { stdout: string; stderr: string; status: number } {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], {
        cwd: project,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, XDG_STATE_HOME: state, CLAUDE_PROJECT_DIR: project },
      });
      return { stdout, stderr: "", status: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? ""),
        status: failed.status ?? 1,
      };
    }
  }

  function opened(...args: string[]): OpenResult[] {
    const { stdout, stderr, status } = inProject("open", ...args, "--json");
    expect(stderr).toBe("");
    expect(status).toBe(0);
    return stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as OpenResult);
  }

  function sessionFile(id: string) {
    return path.join(state, "browser-review", "sessions", `${id}.json`);
  }

  it("opens, reuses, closes and reopens sessions per target", () => {
    const [a, b] = opened("a.html", "b.html");
    expect([a!.state, b!.state]).toEqual(["started", "started"]);
    expect(a!.sessionId).not.toBe(b!.sessionId);

    const [again] = opened("./a.html");
    expect(again!.state).toBe("running");
    expect(again!.sessionId).toBe(a!.sessionId);

    const ambiguous = inProject("close");
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stdout).toContain("nothing was closed");
    expect(ambiguous.stdout).toContain(a!.sessionId);
    expect(ambiguous.stdout).toContain(b!.sessionId);

    expect(inProject("close", "a.html").stdout).toContain(`Closed review session ${a!.sessionId}`);
    // The server has exited by the time close returns, so nothing rewrites the file later.
    expect(() => process.kill(a!.pid, 0)).toThrow();

    // A comment left behind on the closed session comes back with it.
    const closed = JSON.parse(fs.readFileSync(sessionFile(a!.sessionId), "utf8"));
    closed.annotations.push({
      id: "a_left",
      sessionId: a!.sessionId,
      status: "pending",
      comment: "Still to do",
      page: { url: "u", path: "/", title: "t" },
      element: { outerHtmlHead: "<p>", tag: "p" },
      sourceHints: [],
      createdAt: new Date().toISOString(),
      questions: [],
    });
    fs.writeFileSync(sessionFile(a!.sessionId), JSON.stringify(closed));

    const [reopened] = opened("a.html");
    expect(reopened!.state).toBe("reopened");
    expect(reopened!.sessionId).toBe(a!.sessionId);
    expect(reopened!.token).not.toBe(a!.token);
    const resumed = JSON.parse(fs.readFileSync(sessionFile(a!.sessionId), "utf8"));
    expect(resumed.session.closedAt).toBeUndefined();
    expect(resumed.annotations.map((x: { id: string }) => x.id)).toEqual(["a_left"]);

    // With one session left running, a bare close closes it.
    expect(inProject("close", "--session", b!.sessionId).status).toBe(0);
    const last = inProject("close");
    expect(last.stdout).toContain(`Closed review session ${a!.sessionId}`);
    expect(last.stdout).toContain("pending 1");
  });

  it("shares one proxy session between entry paths of the same origin", async () => {
    upstream = http.createServer((_req, res) => res.end("<html><body>app</body></html>"));
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", () => resolve()));
    const port = (upstream.address() as { port: number }).port;
    const [admin] = opened(`http://localhost:${port}/admin`);
    const [settings] = opened(`http://localhost:${port}/settings`);
    expect(settings!.state).toBe("running");
    expect(settings!.sessionId).toBe(admin!.sessionId);
    expect(admin!.reviewUrl.endsWith("/admin")).toBe(true);
    expect(settings!.reviewUrl.endsWith("/settings")).toBe(true);
  });

  it("refuses conflicting options and starts nothing when one target is invalid", () => {
    expect(inProject("open", "a.html", "b.html", "--port", "0").stderr).toContain(
      "--port applies to a single target",
    );
    expect(inProject("open", "a.html", "missing.html").stderr).toContain("no such file");
    expect(inProject("status", "--json").stdout).toBe('{"sessions":[]}\n');

    const [a] = opened("a.html");
    const conflict = inProject("open", "a.html", "--port", String(a!.port === 1 ? 2 : 1));
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain(`session ${a!.sessionId} is already running`);
    expect(conflict.stderr).toContain("--port");
  });
});
