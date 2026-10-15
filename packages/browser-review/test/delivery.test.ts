// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { PollDelivery } from "../src/delivery/poll.js";
import { writeSessionFile, readSessionFile } from "../src/store.js";
import { createAnnotation } from "../src/annotations.js";
let dir: string;
const watchWait = async () => [(await readSessionFile("WAIT"))!.session];
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-delivery-"));
  process.env["XDG_STATE_HOME"] = dir;
  await writeSessionFile({
    session: {
      id: "WAIT",
      token: "t",
      mode: "html-file",
      target: "/tmp/a.html",
      projectDir: "/tmp",
      port: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    },
    annotations: [],
  });
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
it("close wakes an outstanding wait and ends it", async () => {
  const delivery = new PollDelivery();
  const waiting = delivery.waitForPending(watchWait, 90_000);
  await new Promise((r) => setTimeout(r, 30));
  await delivery.close();
  expect(await waiting).toEqual([]);
}, 1000);
it("an already aborted wait does not claim comments", async () => {
  const file = (await readSessionFile("WAIT"))!;
  file.annotations.push(
    createAnnotation("WAIT", {
      comment: "Keep me",
      page: { url: "", path: "", title: "" },
      element: { tag: "h1", outerHtmlHead: "" },
      sourceHints: [],
    }),
  );
  await writeSessionFile(file);
  const delivery = new PollDelivery();
  try {
    expect(await delivery.waitForPending(watchWait, 100, AbortSignal.abort())).toEqual([]);
    expect((await readSessionFile("WAIT"))!.annotations[0]!.status).toBe("pending");
  } finally {
    await delivery.close();
  }
});

function sessionFor(id: string) {
  return {
    session: {
      id,
      token: "t",
      mode: "html-file" as const,
      target: `/tmp/${id}.html`,
      projectDir: "/tmp",
      port: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    },
    annotations: [
      createAnnotation(id, {
        comment: `comment-${id}`,
        page: { url: "", path: "", title: "" },
        element: { tag: "p", outerHtmlHead: "" },
        sourceHints: [],
      }),
    ],
  };
}

it("hands out pending comments from every watched session", async () => {
  await writeSessionFile(sessionFor("MULTI-A"));
  await writeSessionFile(sessionFor("MULTI-B"));
  const delivery = new PollDelivery();
  try {
    const watched = async () => [sessionFor("MULTI-A").session, sessionFor("MULTI-B").session];
    const taken = await delivery.waitForPending(watched, 1_000);
    expect(taken.map((g) => [g.session.id, g.annotations.map((a) => a.comment)])).toEqual([
      ["MULTI-A", ["comment-MULTI-A"]],
      ["MULTI-B", ["comment-MULTI-B"]],
    ]);
    expect(await delivery.waitForPending(watched, 0)).toEqual([]);
  } finally {
    await delivery.close();
  }
});

it("watches a session that joins after the wait began", async () => {
  const watched = [sessionFor("LATE-A").session];
  await writeSessionFile({ ...sessionFor("LATE-A"), annotations: [] });
  const delivery = new PollDelivery();
  try {
    const waiting = delivery.waitForPending(async () => [...watched], 5_000);
    await new Promise((r) => setTimeout(r, 100));
    await writeSessionFile(sessionFor("LATE-B"));
    watched.push(sessionFor("LATE-B").session);
    const taken = await waiting;
    expect(taken.map((g) => g.session.id)).toEqual(["LATE-B"]);
  } finally {
    await delivery.close();
  }
}, 5_000);

it("ends the wait once no session is left to watch", async () => {
  const delivery = new PollDelivery();
  try {
    const started = Date.now();
    expect(await delivery.waitForPending(async () => [], 60_000)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  } finally {
    await delivery.close();
  }
});
