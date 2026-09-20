// SPDX-License-Identifier: Apache-2.0
import chokidar, { type FSWatcher } from "chokidar";
import type { Annotation } from "@browser-review/shared";
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
      this.#watcher.on("all", () => this.#wake());
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
    sessionId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Annotation[]> {
    if (this.#closed || signal?.aborted) return [];
    const budget = Math.max(0, Math.min(timeoutMs, REVIEW_WAIT_MAX_MS));
    const deadline = Date.now() + budget;
    this.#ensureWatcher();
    let stamp = await sessionFileStamp(sessionId);

    for (;;) {
      if (this.#closed || signal?.aborted) return [];
      const taken = await takeDeliverable(sessionId);
      if (taken.length > 0) return taken;
      if (signal?.aborted || Date.now() >= deadline) return [];

      await this.#sleepUntilChange(sessionId, stamp, deadline, signal);
      stamp = await sessionFileStamp(sessionId);
    }
  }

  async #sleepUntilChange(
    sessionId: string,
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
        void sessionFileStamp(sessionId).then((now) => {
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
