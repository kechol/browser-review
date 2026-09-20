// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = "";
  let t = now;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ALPHABET[bytes[i]! % 32];
  }
  return out;
}

/**
 * A ULID: 26 Crockford-base32 characters whose leading 10 encode the
 * millisecond timestamp, so plain string sorting is chronological.
 */
export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
