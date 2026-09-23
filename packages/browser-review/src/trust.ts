// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import { trustedOriginsPath } from "./paths.js";
import { acquireLock, writeAtomic } from "./store.js";

export class TrustedOriginsError extends Error {}

export function normalizeTrustedOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TrustedOriginsError("trusted origin must be an absolute HTTPS origin");
  }
  if (url.protocol !== "https:") throw new TrustedOriginsError("trusted origin must use HTTPS");
  if (url.hostname.includes("*")) throw new TrustedOriginsError("trusted origin must be exact");
  if (url.username || url.password) {
    throw new TrustedOriginsError("trusted origin must not contain a username or password");
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) {
    throw new TrustedOriginsError("trusted origin must not contain a path, query, or fragment");
  }
  return url.origin;
}

export async function readTrustedOrigins(file = trustedOriginsPath()): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new TrustedOriginsError("unable to read trusted origins configuration", { cause: error });
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new Error("invalid trusted origin list");
    }
    const normalized = parsed.map(normalizeTrustedOrigin);
    if (new Set(normalized).size !== normalized.length) {
      throw new Error("duplicate trusted origin");
    }
    return normalized.toSorted();
  } catch (error) {
    if (error instanceof TrustedOriginsError) {
      throw new TrustedOriginsError("trusted origins configuration is invalid", { cause: error });
    }
    throw new TrustedOriginsError("trusted origins configuration is invalid");
  }
}

export async function updateTrustedOrigin(
  action: "add" | "remove",
  raw: string,
  file = trustedOriginsPath(),
): Promise<{ origin: string; changed: boolean }> {
  const origin = normalizeTrustedOrigin(raw);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const release = await acquireLock(file);
  try {
    const current = await readTrustedOrigins(file);
    const values = new Set(current);
    const had = values.has(origin);
    if (action === "add") values.add(origin);
    else values.delete(origin);
    const changed = action === "add" ? !had : had;
    if (changed) await writeAtomic(file, `${JSON.stringify([...values].toSorted(), null, 2)}\n`);
    return { origin, changed };
  } finally {
    await release();
  }
}

export async function isTrustedTarget(raw: string, file = trustedOriginsPath()): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return (await readTrustedOrigins(file)).includes(url.origin);
}
