// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { PollDelivery } from "../src/delivery/poll.js";
import { writeSessionFile, readSessionFile } from "../src/store.js";
import { createAnnotation } from "../src/annotations.js";
let dir: string;
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
  const waiting = delivery.waitForPending("WAIT", 90_000);
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
    expect(await delivery.waitForPending("WAIT", 100, AbortSignal.abort())).toEqual([]);
    expect((await readSessionFile("WAIT"))!.annotations[0]!.status).toBe("pending");
  } finally {
    await delivery.close();
  }
});
