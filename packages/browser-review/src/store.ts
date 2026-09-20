// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Annotation, Session, SessionFile } from "@browser-review/shared";
import { SESSION_TTL_MS } from "@browser-review/shared";
import { sessionPath, sessionsDir, stateDir } from "./paths.js";

/** A lock older than this is assumed to belong to a process that died holding it. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(sessionsDir(), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(stateDir(), "logs"), { recursive: true, mode: 0o700 });
}

/** True when a process with this pid exists and we are allowed to signal it. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(file: string): Promise<() => Promise<void>> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        await fs.rm(lock, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const age = await fs
        .stat(lock)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => Number.POSITIVE_INFINITY);
      if (age > LOCK_STALE_MS) {
        await fs.rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for the session lock at ${lock}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

/**
 * Write through a temporary file in the same directory and rename over the
 * target, so a reader either sees the previous file or the new one and never a
 * half-written mixture.
 */
async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function readSessionFile(id: string): Promise<SessionFile | null> {
  try {
    const raw = await fs.readFile(sessionPath(id), "utf8");
    return JSON.parse(raw) as SessionFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSessionFile(file: SessionFile): Promise<void> {
  await ensureDirs();
  await writeAtomic(sessionPath(file.session.id), `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Read, transform, write — under a lock, because the HTTP server and the stdio
 * MCP process are separate processes editing the same file.
 */
export async function updateSessionFile(
  id: string,
  mutate: (file: SessionFile) => void | Promise<void>,
): Promise<SessionFile> {
  await ensureDirs();
  const release = await acquireLock(sessionPath(id));
  try {
    const current = await readSessionFile(id);
    if (!current) throw new Error(`no session ${id}`);
    const before = JSON.stringify(current);
    await mutate(current);
    if (JSON.stringify(current) !== before) {
      await writeAtomic(sessionPath(id), `${JSON.stringify(current, null, 2)}\n`);
    }
    return current;
  } finally {
    await release();
  }
}

export async function listSessionFiles(): Promise<SessionFile[]> {
  await ensureDirs();
  const entries = await fs.readdir(sessionsDir()).catch(() => [] as string[]);
  const files: SessionFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    const file = await readSessionFile(id).catch(() => null);
    if (file?.session?.id) files.push(file);
  }
  // Session ids are ULIDs, so lexical order is creation order.
  files.sort((a, b) => (a.session.id < b.session.id ? 1 : -1));
  return files;
}

export function isSessionActive(session: Session): boolean {
  return !session.closedAt && isProcessAlive(session.pid);
}

/**
 * Resolve a session reference. `latest` means the newest session whose server
 * process is still running, which is what a skill or hook wants when the user
 * has not named one.
 */
export async function resolveSession(ref: string | undefined): Promise<SessionFile | null> {
  if (ref && ref !== "latest") return readSessionFile(ref);
  const files = await listSessionFiles();
  return files.find((f) => isSessionActive(f.session)) ?? null;
}

export async function deleteSessionFile(id: string): Promise<void> {
  await fs.rm(sessionPath(id), { force: true });
  await fs.rm(`${sessionPath(id)}.lock`, { force: true });
}

/**
 * Drop session files that are both inactive and older than the TTL. Called on
 * startup so that state does not accumulate forever without a cleanup command.
 */
export async function sweepStaleSessions(now = Date.now()): Promise<string[]> {
  const removed: string[] = [];
  for (const file of await listSessionFiles()) {
    const { session } = file;
    if (isSessionActive(session)) continue;
    const created = Date.parse(session.createdAt);
    if (Number.isFinite(created) && now - created < SESSION_TTL_MS) continue;
    await deleteSessionFile(session.id);
    removed.push(session.id);
  }
  return removed;
}

export function pendingOf(file: SessionFile): Annotation[] {
  return file.annotations.filter((a) => a.status === "pending");
}

/**
 * Hand the caller everything that is waiting for an agent and mark it as taken,
 * all under the session lock so that two concurrent `review_wait` calls cannot
 * both receive the same annotation.
 *
 * Two things qualify: annotations nobody has looked at yet, and annotations
 * whose human has since answered an agent's question.
 */
export async function takeDeliverable(sessionId: string): Promise<Annotation[]> {
  let taken: Annotation[] = [];
  await updateSessionFile(sessionId, (file) => {
    const out: Annotation[] = [];
    for (const annotation of file.annotations) {
      if (annotation.status === "pending") {
        annotation.status = "acknowledged";
        for (const q of annotation.questions) {
          if (q.from === "human") q.delivered = true;
        }
        out.push(annotation);
        continue;
      }
      const undelivered = annotation.questions.filter((q) => q.from === "human" && !q.delivered);
      if (undelivered.length > 0 && annotation.status !== "dismissed") {
        for (const q of undelivered) q.delivered = true;
        out.push(annotation);
      }
    }
    taken = structuredClone(out);
  });
  return taken;
}

/** Cheap change detector for pollers: size plus modification time. */
export async function sessionFileStamp(id: string): Promise<string> {
  try {
    const s = await fs.stat(sessionPath(id));
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "";
  }
}
