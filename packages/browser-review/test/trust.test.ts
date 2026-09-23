// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isTrustedTarget,
  normalizeTrustedOrigin,
  readTrustedOrigins,
  updateTrustedOrigin,
} from "../src/trust.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-trust-"));
  file = path.join(dir, "trusted-origins.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("trusted origins", () => {
  it("normalizes HTTPS origins and rejects broader or credentialed forms", () => {
    expect(normalizeTrustedOrigin("https://Example.COM:443/")).toBe("https://example.com");
    expect(normalizeTrustedOrigin("https://example.com:8443")).toBe("https://example.com:8443");
    for (const invalid of [
      "http://example.com",
      "https://*.example.com",
      "https://user:secret@example.com",
      "https://example.com/path",
      "https://example.com/?query=1",
      "https://example.com/#fragment",
    ]) {
      expect(() => normalizeTrustedOrigin(invalid)).toThrow();
    }
  });

  it("adds, lists, and removes exact origins idempotently in sorted order", async () => {
    await updateTrustedOrigin("add", "https://z.example.test", file);
    await updateTrustedOrigin("add", "https://a.example.test:443/", file);
    await expect(updateTrustedOrigin("add", "https://a.example.test", file)).resolves.toMatchObject(
      {
        changed: false,
      },
    );
    expect(await readTrustedOrigins(file)).toEqual([
      "https://a.example.test",
      "https://z.example.test",
    ]);
    expect(await isTrustedTarget("https://a.example.test/admin", file)).toBe(true);
    expect(await isTrustedTarget("https://a.example.test:8443/admin", file)).toBe(false);
    await expect(
      updateTrustedOrigin("remove", "https://a.example.test", file),
    ).resolves.toMatchObject({ changed: true });
    expect(await isTrustedTarget("https://a.example.test/admin", file)).toBe(false);
  });

  it("serializes concurrent updates without losing entries", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        updateTrustedOrigin("add", `https://site-${index}.example.test`, file),
      ),
    );
    expect(await readTrustedOrigins(file)).toHaveLength(12);
  });

  it("fails closed on malformed or invalid configuration", async () => {
    await fs.writeFile(file, "{not-json");
    await expect(readTrustedOrigins(file)).rejects.toThrow(/configuration is invalid/);
    await fs.writeFile(file, '["http://insecure.example.test"]');
    await expect(isTrustedTarget("https://insecure.example.test", file)).rejects.toThrow(
      /configuration is invalid/,
    );
  });
});
