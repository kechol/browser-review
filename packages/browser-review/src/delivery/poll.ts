// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import type { Session, SessionFile } from "@browser-review/shared";
import { REVIEW_WAIT_MAX_MS } from "@browser-review/shared";
import { sessionsDir } from "../paths.js";
import { sessionFileStamp, takeDeliverable } from "../store.js";
import type { Delivery } from "./index.js";

/**
 * How often we re-stat the session file when the filesystem watcher tells us
 * nothing. Atomic renames and network filesystems both defeat inotify often
 * enough that a human would notice; half a second is invisible to them.
 */
const POLL_INTERVAL_MS = 500;

export class PollDelivery implements Delivery {
  #closed = false;
  #watcher: FSWatcher | null = null;
  #waiters = new Set<() => void>();

  #ensureWatcher(): void {
    if (this.#watcher) return;
    try {
      // Watch the directory rather than the file: `writeAtomic` replaces the
      // inode on every write, which drops a file-level watch.
      this.#watcher = chokidar.watch(sessionsDir(), {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
      });
      // Only session files matter. Lock files come and go on every
      // `takeDeliverable`, and waking on them would make a wait wake itself.
      this.#watcher.on("all", (_event, file) => {
        if (file.endsWith(".json")) this.#wake();
      });
      this.#watcher.on("error", () => {
        // Losing the watcher is survivable: the poll below still fires.
      });
    } catch {
      this.#watcher = null;
    }
  }

  #wake(): void {
    for (const waiter of this.#waiters) waiter();
  }

  async waitForPending(
    sessions: () => Promise<Session[]>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<SessionFile[]> {
    if (this.#closed || signal?.aborted) return [];
    const budget = Math.max(0, Math.min(timeoutMs, REVIEW_WAIT_MAX_MS));
    const deadline = Date.now() + budget;
    this.#ensureWatcher();

    for (;;) {
      if (this.#closed || signal?.aborted) return [];
      const watched = await sessions();
      if (watched.length === 0) return [];
      // Stamped before taking, so a write that lands in between still wakes the sleep.
      const ids = watched.map((session) => session.id);
      const stamp = await setStamp(ids);
      const groups = await Promise.all(
        watched.map(async (session) => ({
          session,
          // A session swept or removed since it was selected has nothing to hand out.
          annotations: await takeDeliverable(session.id).catch(() => []),
        })),
      );
      const taken = groups.filter((group) => group.annotations.length > 0);
      if (taken.length > 0) return taken;
      if (signal?.aborted || Date.now() >= deadline) return [];

      await this.#sleepUntilChange(ids, stamp, deadline, signal);
    }
  }

  async #sleepUntilChange(
    ids: string[],
    stamp: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.#waiters.delete(finish);
        clearInterval(timer);
        clearTimeout(timeout);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setInterval(() => {
        if (Date.now() >= deadline) return finish();
        void setStamp(ids).then((now) => {
          if (now !== stamp) finish();
        });
      }, POLL_INTERVAL_MS);
      const timeout = setTimeout(finish, Math.max(0, deadline - Date.now()));
      this.#waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
      if (this.#closed || signal?.aborted) finish();
    });
  }

  notifyUpdated(): void {
    // Updates travel through the session file; the review server watches it and
    // pushes to connected browsers. Nothing extra to do here.
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wake();
    this.#waiters.clear();
    await this.#watcher?.close();
    this.#watcher = null;
  }
}

/**
 * Changes when a session file appears or disappears, or when a watched one is
 * written. Cheap enough for every tick: one directory listing and a stat per
 * watched session, without reading any file. Lock and temporary files are
 * left out so that taking annotations does not wake the waiter itself.
 */
async function setStamp(ids: string[]): Promise<string> {
  const entries = await fs.readdir(sessionsDir()).catch(() => [] as string[]);
  const files = entries.filter((entry) => entry.endsWith(".json")).toSorted();
  const stamps = await Promise.all(ids.map(async (id) => `${id}=${await sessionFileStamp(id)}`));
  return `${files.join(",")}|${stamps.join(",")}`;
}
