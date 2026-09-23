// SPDX-License-Identifier: Apache-2.0
import { homedir } from "node:os";
import path from "node:path";

/**
 * Root for everything this tool persists.
 *
 * Deliberately outside the repository under review: writing session files into
 * the project would put review comments and tokens one `git add .` away from a
 * public commit.
 */
export function stateDir(): string {
  return stateDirFrom(process.env["XDG_STATE_HOME"], homedir());
}

export function stateDirFrom(xdg: string | undefined, home: string): string {
  return xdg && xdg.trim() !== ""
    ? path.join(xdg, "browser-review")
    : path.join(home, ".browser-review");
}

export function sessionsDir(): string {
  return path.join(stateDir(), "sessions");
}

export function sessionPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid session id");
  return path.join(sessionsDir(), `${id}.json`);
}

export function logPath(id: string): string {
  return path.join(stateDir(), "logs", `${id}.log`);
}

export function trustedOriginsPath(): string {
  return path.join(stateDir(), "trusted-origins.json");
}
