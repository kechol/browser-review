// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionContextFor, sessionContextForId } from "../src/mcp.js";
import { resolveSession, writeSessionFile } from "../src/store.js";
import { createAnnotation } from "../src/annotations.js";

const hook = fileURLToPath(new URL("../../../scripts/inject-pending.mjs", import.meta.url));
let tmp: string;
let project: string;
let other: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "review-isolation-"));
  project = path.join(tmp, "project");
  other = path.join(tmp, "project-other");
  await fs.mkdir(project);
  await fs.mkdir(other);
  vi.stubEnv("XDG_STATE_HOME", tmp);
  vi.stubEnv("CLAUDE_PROJECT_DIR", project);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function put(
  id: string,
  projectDir: unknown,
  options: { pending?: boolean; pid?: number; closedAt?: string } = {},
) {
  const file = {
    session: {
      id,
      token: "t".repeat(32),
      mode: "html-file" as const,
      target: path.join(other, "private-page.html"),
      projectDir: projectDir as string,
      port: 1234,
      pid: options.pid ?? process.pid,
      createdAt: new Date().toISOString(),
      ...(options.closedAt ? { closedAt: options.closedAt } : {}),
    },
    annotations:
      options.pending === false
        ? []
        : [
            createAnnotation(id, {
              comment: `comment-${id}`,
              page: { url: "u", path: "/", title: "t" },
              element: { outerHtmlHead: "<p>", tag: "p" },
              sourceHints: [],
            }),
          ],
  };
  await writeSessionFile(file);
}

function runHook(cwd = other): string {
  return execFileSync(process.execPath, [hook], { cwd, env: process.env, encoding: "utf8" });
}

it("never injects or automatically resolves a newer foreign session", async () => {
  await put("01AAA", project);
  await put("01ZZZ", other);
  expect((await sessionContextFor("latest")())?.session.id).toBe("01AAA");
  const output = runHook();
  expect(output).toContain("comment-01AAA");
  expect(output).not.toContain("comment-01ZZZ");
  // Explicit handoffs and global administrative selection retain their contract.
  expect((await sessionContextFor("01ZZZ")())?.session.id).toBe("01ZZZ");
  expect((await sessionContextForId("01ZZZ")())?.session.id).toBe("01ZZZ");
  expect((await resolveSession("latest"))?.session.id).toBe("01ZZZ");
});

it("emits nothing when only a foreign project has a session", async () => {
  await put("01ZZZ", other);
  expect(await sessionContextFor(undefined)()).toBeNull();
  expect(runHook()).toBe("");
});

it.each([undefined, null, "", ".", 42, {}])(
  "rejects invalid stored project metadata: %s",
  async (metadata) => {
    await put("01ZZZ", metadata);
    expect(await sessionContextFor("latest")()).toBeNull();
    expect(runHook()).toBe("");
  },
);

it("rejects nonexistent and file-valued project metadata", async () => {
  const file = path.join(tmp, "file");
  await fs.writeFile(file, "fixture");
  await put("01AAA", file);
  await put("01ZZZ", path.join(tmp, "missing"));
  expect(await sessionContextFor("latest")()).toBeNull();
  expect(runHook()).toBe("");
});

it("rejects parent, child and sibling-prefix projects", async () => {
  const child = path.join(project, "child");
  await fs.mkdir(child);
  await put("01AAA", tmp);
  await put("01BBB", child);
  await put("01ZZZ", other);
  expect(await sessionContextFor("latest")()).toBeNull();
  expect(runHook()).toBe("");
});

it("accepts canonical aliases of the same directory", async () => {
  const alias = path.join(tmp, "alias");
  await fs.symlink(project, alias);
  await put("01AAA", alias);
  expect((await sessionContextFor("latest")())?.session.id).toBe("01AAA");
  expect(runHook()).toContain("comment-01AAA");
});

it("falls back to cwd only when the project environment is absent", async () => {
  vi.stubEnv("CLAUDE_PROJECT_DIR", undefined);
  await put("01AAA", process.cwd());
  expect((await sessionContextFor("latest")())?.session.id).toBe("01AAA");
  expect(runHook(process.cwd())).toContain("comment-01AAA");
  vi.stubEnv("CLAUDE_PROJECT_DIR", "");
  expect(await sessionContextFor("latest")()).toBeNull();
  expect(runHook(process.cwd())).toBe("");
});

it("reselects the latest active matching session without falling back for comments", async () => {
  const resolve = sessionContextFor("latest");
  await put("01AAA", project);
  expect((await resolve())?.session.id).toBe("01AAA");
  await put("01BBB", project, { pending: false });
  await put("01CCC", project, { closedAt: new Date().toISOString() });
  await put("01DDD", project, { pid: 2 ** 22 });
  await put("01ZZZ", other);
  expect((await resolve())?.session.id).toBe("01BBB");
  expect(runHook()).toBe("");
});

it("uses the new home fallback without reading or changing the former fallback", async () => {
  const home = path.join(tmp, "isolated-home");
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", undefined);
  await fs.mkdir(home, { recursive: true });
  await put("01NEW", project);

  const oldSessions = path.join(home, ".local", "state", "browser-review", "sessions");
  const oldFile = path.join(oldSessions, "01OLD.json");
  const oldContents = `${JSON.stringify({ marker: "must remain untouched" })}\n`;
  await fs.mkdir(oldSessions, { recursive: true });
  await fs.writeFile(oldFile, oldContents);

  expect(runHook()).toContain("comment-01NEW");
  expect(runHook()).not.toContain("01OLD");
  expect(await fs.readFile(oldFile, "utf8")).toBe(oldContents);
});
