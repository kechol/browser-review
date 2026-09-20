// SPDX-License-Identifier: Apache-2.0
import type { Annotation } from "@browser-review/shared";

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
   * Resolve with annotations that need an agent's attention, or with an empty
   * array once `timeoutMs` elapses. Annotations handed out this way are marked
   * as taken, so a second caller does not receive them again.
   */
  waitForPending(sessionId: string, timeoutMs: number, signal?: AbortSignal): Promise<Annotation[]>;
  /** Tell the other side that an annotation changed. */
  notifyUpdated(annotation: Annotation): void;
  close(): Promise<void>;
}
