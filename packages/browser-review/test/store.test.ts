// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-test-"));
  process.env["XDG_STATE_HOME"] = tmp;
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const {
  ensureDirs,
  listSessionFiles,
  readSessionFile,
  resolveSession,
  sweepStaleSessions,
  takeDeliverable,
  updateSessionFile,
  writeSessionFile,
} = await import("../src/store.js");
const { createAnnotation } = await import("../src/annotations.js");

function session(id: string, overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id,
      token: "t".repeat(32),
      mode: "html-file" as const,
      target: "/tmp/page.html",
      projectDir: "/tmp",
      port: 1234,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ...overrides,
    },
    annotations: [],
  };
}

function draft(comment: string) {
  return {
    comment,
    page: { url: "u", path: "/", title: "t" },
    element: { outerHtmlHead: "<p>", tag: "p" },
    sourceHints: [],
  };
}

beforeEach(async () => {
  await ensureDirs();
  for (const file of await listSessionFiles()) {
    await fs.rm(path.join(tmp, "browser-review", "sessions", `${file.session.id}.json`), {
      force: true,
    });
  }
});

describe("session files", () => {
  it("round-trips through the state directory, not the project", async () => {
    await writeSessionFile(session("01AAA"));
    const read = await readSessionFile("01AAA");
    expect(read?.session.port).toBe(1234);
    const onDisk = path.join(tmp, "browser-review", "sessions", "01AAA.json");
    await expect(fs.access(onDisk)).resolves.toBeUndefined();
  });

  it("returns null for a session that was never written", async () => {
    expect(await readSessionFile("nope")).toBeNull();
  });

  it("applies concurrent updates without losing any of them", async () => {
    await writeSessionFile(session("01BBB"));
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        updateSessionFile("01BBB", (file) => {
          file.annotations.push(createAnnotation("01BBB", draft(`c${i}`)));
        }),
      ),
    );
    const read = await readSessionFile("01BBB");
    expect(read?.annotations).toHaveLength(12);
  });
});

describe("resolveSession", () => {
  it("picks the newest session whose server is still alive", async () => {
    await writeSessionFile(session("01AAA"));
    await writeSessionFile(session("01CCC"));
    expect((await resolveSession("latest"))?.session.id).toBe("01CCC");
  });

  it("skips a session whose process is gone", async () => {
    await writeSessionFile(session("01AAA"));
    await writeSessionFile(session("01DDD", { pid: 2 ** 22 }));
    expect((await resolveSession("latest"))?.session.id).toBe("01AAA");
  });

  it("skips a session that was closed", async () => {
    await writeSessionFile(session("01AAA"));
    await writeSessionFile(session("01EEE", { closedAt: new Date().toISOString() }));
    expect((await resolveSession("latest"))?.session.id).toBe("01AAA");
  });

  it("honours an explicit id over recency", async () => {
    await writeSessionFile(session("01AAA"));
    await writeSessionFile(session("01CCC"));
    expect((await resolveSession("01AAA"))?.session.id).toBe("01AAA");
  });
});

describe("takeDeliverable", () => {
  it("hands out pending annotations once and only once", async () => {
    await writeSessionFile(session("01FFF"));
    await updateSessionFile("01FFF", (file) => {
      file.annotations.push(createAnnotation("01FFF", draft("first")));
      file.annotations.push(createAnnotation("01FFF", draft("second")));
    });

    const first = await takeDeliverable("01FFF");
    expect(first.map((a) => a.comment)).toEqual(["first", "second"]);
    expect(await takeDeliverable("01FFF")).toHaveLength(0);
  });

  it("brings an acknowledged annotation back when the reviewer answers", async () => {
    await writeSessionFile(session("01GGG"));
    await updateSessionFile("01GGG", (file) => {
      file.annotations.push(createAnnotation("01GGG", draft("which one?")));
    });
    const [taken] = await takeDeliverable("01GGG");

    await updateSessionFile("01GGG", (file) => {
      file.annotations[0]!.questions.push({
        from: "human",
        text: "the hero",
        at: new Date().toISOString(),
        delivered: false,
      });
    });

    const again = await takeDeliverable("01GGG");
    expect(again[0]?.id).toBe(taken?.id);
    // and not a third time
    expect(await takeDeliverable("01GGG")).toHaveLength(0);
  });

  it("leaves a dismissed annotation alone even if answered", async () => {
    await writeSessionFile(session("01HHH"));
    await updateSessionFile("01HHH", (file) => {
      const annotation = createAnnotation("01HHH", draft("nope"));
      annotation.status = "dismissed";
      annotation.questions.push({
        from: "human",
        text: "still here",
        at: new Date().toISOString(),
        delivered: false,
      });
      file.annotations.push(annotation);
    });
    expect(await takeDeliverable("01HHH")).toHaveLength(0);
  });
});

describe("sweepStaleSessions", () => {
  it("removes closed sessions past the time-to-live and keeps the rest", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await writeSessionFile(session("01III", { pid: 2 ** 22, createdAt: old }));
    await writeSessionFile(session("01JJJ", { pid: 2 ** 22 }));
    await writeSessionFile(session("01KKK"));

    expect(await sweepStaleSessions()).toEqual(["01III"]);
    const left = (await listSessionFiles()).map((f) => f.session.id).sort();
    expect(left).toEqual(["01JJJ", "01KKK"]);
  });
});
