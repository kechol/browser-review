// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Session } from "@browser-review/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAnnotation } from "../src/annotations.js";
import { PollDelivery } from "../src/delivery/poll.js";
import { createMcpServer, sessionContextFor, type ToolContext } from "../src/mcp.js";
import { readSessionFile, updateSessionFile, writeSessionFile } from "../src/store.js";

let tmp: string;
let project: string;
let delivery: PollDelivery;
let client: Client;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "review-mcp-"));
  project = path.join(tmp, "project");
  await fs.mkdir(project);
  vi.stubEnv("XDG_STATE_HOME", tmp);
  vi.stubEnv("CLAUDE_PROJECT_DIR", project);
});

afterEach(async () => {
  await client?.close();
  await delivery?.close();
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function put(id: string, options: { closedAt?: string } = {}) {
  await writeSessionFile({
    session: {
      id,
      token: "t".repeat(32),
      mode: "html-file",
      target: path.join(project, `${id}.html`),
      projectDir: project,
      port: 1234,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ...(options.closedAt ? { closedAt: options.closedAt } : {}),
    },
    annotations: [
      {
        ...createAnnotation(id, {
          comment: `comment-${id}`,
          page: { url: "u", path: "/", title: "t" },
          element: { outerHtmlHead: "<p>", tag: "p" },
          sourceHints: [],
        }),
        id: `a_${id}`,
      },
    ],
  });
}

async function connect(screenshot?: ToolContext["screenshot"]) {
  delivery = new PollDelivery();
  const server = createMcpServer({
    resolveSessions: sessionContextFor("project"),
    delivery,
    ...(screenshot ? { screenshot } : {}),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "multi-session-test", version: "1" });
  await client.connect(clientSide);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text ?? "").join("\n"), isError: !!result.isError };
}

it("delivers comments from every session with each session's own scope", async () => {
  await put("01AAA");
  await put("01BBB");
  await connect();
  const { text } = await call("review_wait", { timeoutMs: 0 });
  const a = text.indexOf("# Session 01AAA");
  const b = text.indexOf("# Session 01BBB");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(-1);
  const sectionA = text.slice(a, b > a ? b : undefined);
  expect(sectionA).toContain("comment-01AAA");
  expect(sectionA).toContain(path.join(project, "01AAA.html"));
  expect(sectionA).not.toContain(path.join(project, "01BBB.html"));
  expect((await call("review_wait", { timeoutMs: 0 })).text).toContain("No new annotations");
});

it("resolves an annotation in the session that owns it and judges scope there", async () => {
  await put("01AAA");
  await put("01BBB");
  await connect();

  const inScope = await call("review_resolve", {
    id: "a_01BBB",
    summary: "Fixed",
    filesChanged: [path.join(project, "01BBB.html")],
  });
  expect(inScope.isError).toBe(false);
  expect(inScope.text).not.toContain("Warning");
  expect((await readSessionFile("01BBB"))!.annotations[0]!.status).toBe("resolved");
  expect((await readSessionFile("01AAA"))!.annotations[0]!.status).toBe("pending");

  // Another session's file is not in scope just because that session is running.
  const crossed = await call("review_resolve", {
    id: "a_01AAA",
    summary: "Fixed",
    filesChanged: [path.join(project, "01BBB.html")],
  });
  expect(crossed.text).toContain("Warning");
  expect(crossed.text).toContain("outside this session's editing scope");
});

it("refuses changes to a closed session's annotation but still shows it", async () => {
  await put("01AAA");
  await put("01CCC", { closedAt: new Date().toISOString() });
  await connect();

  for (const [name, args] of [
    ["review_resolve", { id: "a_01CCC", summary: "x", filesChanged: [] }],
    ["review_dismiss", { id: "a_01CCC", reason: "x" }],
    ["review_ask", { id: "a_01CCC", question: "x" }],
  ] as const) {
    const result = await call(name, args);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("session_closed");
  }
  expect((await readSessionFile("01CCC"))!.annotations[0]!.status).toBe("pending");
  expect((await call("review_get", { id: "a_01CCC" })).text).toContain("comment-01CCC");
  expect((await call("review_get", { id: "a_missing" })).text).toContain("not_found");
  expect((await call("review_status")).text).not.toContain("01CCC");
});

it("reports when every watched session closes during a wait", async () => {
  await put("01AAA");
  await connect();
  await call("review_wait", { timeoutMs: 0 });
  const waiting = call("review_wait", { timeoutMs: 60_000 });
  await new Promise((r) => setTimeout(r, 100));
  await updateSessionFile("01AAA", (file) => {
    file.session.closedAt = new Date().toISOString();
  });
  expect((await waiting).text).toContain("every review session being watched has closed");
}, 5_000);

it("asks which session to capture when several are running", async () => {
  await put("01AAA");
  await put("01BBB");
  const captured: Session[] = [];
  await connect(async (session) => {
    captured.push(session);
    return { base64: "", mimeType: "image/png" };
  });
  const ambiguous = await call("review_screenshot");
  expect(ambiguous.isError).toBe(true);
  expect(ambiguous.text).toContain("ambiguous_session");
  await call("review_screenshot", { sessionId: "01AAA" });
  expect(captured.map((s) => s.id)).toEqual(["01AAA"]);
});
