// SPDX-License-Identifier: Apache-2.0
import type { Annotation, Session, SessionFile } from "@browser-review/shared";

/**
 * How an agent learns that there is something to do.
 *
 * The only implementation today polls the session file, because that is the
 * one channel every process involved can see. The interface exists so that a
 * push transport can be added later without touching the MCP tool definitions
 * or the overlay.
 */
export interface Delivery {
  /**
   * Resolve with the annotations that need an agent's attention, grouped by
   * the session they belong to, or with an empty array once `timeoutMs`
   * elapses or no session is left to watch. Annotations handed out this way
   * are marked as taken, so a second caller does not receive them again.
   *
   * `sessions` is asked again while waiting, so a session opened after the
   * wait began is watched too, and one that closed stops being watched.
   */
  waitForPending(
    sessions: () => Promise<Session[]>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<SessionFile[]>;
  /** Tell the other side that an annotation changed. */
  notifyUpdated(annotation: Annotation): void;
  close(): Promise<void>;
}
