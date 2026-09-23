// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
