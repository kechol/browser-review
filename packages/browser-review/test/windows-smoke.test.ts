// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnnotation } from "../src/annotations.js";
import { readSessionFile, updateSessionFile, writeSessionFile } from "../src/store.js";

const describeWindows = process.platform === "win32" ? describe : describe.skip;
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let root: string;
let stateHome: string;

describeWindows("Windows CLI smoke", () => {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-review Windows 日本語 "));
    stateHome = path.join(root, "state root");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("opens, reads, lists, and closes a session in a spaced Unicode path", async () => {
    const html = path.join(root, "見本 page.html");
    fs.writeFileSync(html, "<!doctype html><title>Windows smoke</title><h1>Ready</h1>");
    const env = { ...process.env, XDG_STATE_HOME: stateHome };
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });

    const opened = JSON.parse(run("open", html, "--project-dir", root, "--json")) as {
      sessionId: string;
      reviewUrl: string;
      port: number;
    };
    expect((await fetch(opened.reviewUrl)).status).toBe(200);
    const status = JSON.parse(run("status", "--session", opened.sessionId, "--json")) as {
      sessionId: string;
      active: boolean;
    };
    expect(status).toMatchObject({ sessionId: opened.sessionId, active: true });

    expect(run("close", "--session", opened.sessionId)).toContain("Closed review session");
    await expect
      .poll(
        async () =>
          fetch(opened.reviewUrl)
            .then(() => false)
            .catch(() => true),
        {
          timeout: 10_000,
        },
      )
      .toBe(true);
  }, 30_000);

  it("serializes concurrent atomic state updates", async () => {
    const previous = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = stateHome;
    const id = "WINSTORE01";
    try {
      await writeSessionFile({
        session: {
          id,
          token: "t".repeat(32),
          mode: "html-file",
          target: path.join(root, "見本 page.html"),
          projectDir: root,
          port: 1234,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        },
        annotations: [],
      });
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          updateSessionFile(id, (file) => {
            file.annotations.push(
              createAnnotation(id, {
                comment: `concurrent-${index}`,
                page: { url: "https://example.test", path: "/", title: "fixture" },
                element: { outerHtmlHead: "<button>", tag: "button" },
                sourceHints: [],
              }),
            );
          }),
        ),
      );
      expect((await readSessionFile(id))?.annotations).toHaveLength(8);
    } finally {
      if (previous === undefined) delete process.env["XDG_STATE_HOME"];
      else process.env["XDG_STATE_HOME"] = previous;
    }
  });
});
