// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookieFileError, importCookieFile } from "../src/cookie-file.js";
import { RemoteCookieJar } from "../src/cookie-jar.js";

let dir: string;
const target = new URL("https://staging.example.test:8443/app/start");
const now = Date.UTC(2026, 8, 22);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-cookies-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, body: string | Buffer): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, body);
  return file;
}

describe("Netscape cookie import", () => {
  it("imports host, domain, HttpOnly, session, expiry, Secure, and Path records", async () => {
    const future = Math.floor((now + 60_000) / 1000);
    const file = await write(
      "cookies.txt",
      [
        "# Netscape HTTP Cookie File",
        `staging.example.test\tFALSE\t/\tTRUE\t0\thost\tone`,
        `#HttpOnly_.example.test\tTRUE\t/app\tTRUE\t${future}\tdomain\ttwo`,
        `staging.example.test\tFALSE\t/expired\tTRUE\t1\texpired\tno`,
        `other.example.test\tFALSE\t/\tTRUE\t0\tforeign\tno`,
        "",
      ].join("\n"),
    );
    const jar = new RemoteCookieJar(target);
    await expect(importCookieFile(file, target, jar, now)).resolves.toBe(2);
    expect(jar.header(new URL("https://staging.example.test:8443/app/page"), now)).toBe(
      "domain=two; host=one",
    );
    expect(jar.header(new URL("https://staging.example.test:9443/app/page"), now)).toBeUndefined();
    expect(jar.header(new URL("http://staging.example.test:8443/app/page"), now)).toBeUndefined();
  });

  it("allows an empty jar without sending a Cookie header", async () => {
    const file = await write("empty.txt", "# Netscape HTTP Cookie File\n");
    const jar = new RemoteCookieJar(target);
    await expect(importCookieFile(file, target, jar, now)).resolves.toBe(0);
    expect(jar.header(target, now)).toBeUndefined();
  });

  it("keeps same-name cookies on different paths distinct and orders the longest path first", async () => {
    const file = await write(
      "paths.txt",
      [
        "staging.example.test\tFALSE\t/\tTRUE\t0\tsession\troot",
        "staging.example.test\tFALSE\t/app\tTRUE\t0\tsession\tapp",
      ].join("\n"),
    );
    const jar = new RemoteCookieJar(target);
    await expect(importCookieFile(file, target, jar, now)).resolves.toBe(2);
    expect(jar.header(new URL("https://staging.example.test:8443/app/page"), now)).toBe(
      "session=app; session=root",
    );
    expect(jar.header(new URL("https://staging.example.test:8443/elsewhere"), now)).toBe(
      "session=root",
    );
  });

  it.each([
    ["malformed", "staging.example.test\tFALSE\t/\tTRUE\t0\tmissing-value"],
    ["control", "staging.example.test\tFALSE\t/\tTRUE\t0\tname\tbad\u0000value"],
    ["semicolon", "staging.example.test\tFALSE\t/\tTRUE\t0\tname\tbad;value"],
    ["carriage-return", "staging.example.test\tFALSE\t/\tTRUE\t0\tname\tbad\rvalue"],
    ["unicode-header", "staging.example.test\tFALSE\t/\tTRUE\t0\tname\t値"],
  ])("rejects %s input without echoing its value", async (_case, body) => {
    const file = await write("bad.txt", body);
    const jar = new RemoteCookieJar(target);
    const error = await importCookieFile(file, target, jar, now).catch((reason) => reason as Error);
    expect(error).toBeInstanceOf(CookieFileError);
    expect(error.message).not.toContain("bad;value");
    expect(error.message).not.toContain("bad\u0000value");
  });

  it("rejects oversized files and more than 1,000 records", async () => {
    const oversized = await write("large.txt", Buffer.alloc(1024 * 1024 + 1, 65));
    await expect(
      importCookieFile(oversized, target, new RemoteCookieJar(target), now),
    ).rejects.toThrow(/1 MiB/);

    const row = "staging.example.test\tFALSE\t/\tTRUE\t0\tname\tvalue";
    const tooMany = await write("many.txt", Array<string>(1_001).fill(row).join("\n"));
    await expect(
      importCookieFile(tooMany, target, new RemoteCookieJar(target), now),
    ).rejects.toThrow(/1,000/);
  });

  it("rejects HTTP imports and unreadable paths without exposing cookie data", async () => {
    const file = await write(
      "cookies.txt",
      "staging.example.test\tFALSE\t/\tFALSE\t0\tsession\tsynthetic-secret",
    );
    await expect(
      importCookieFile(file, new URL("http://staging.example.test"), new RemoteCookieJar(), now),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      importCookieFile(path.join(dir, "missing"), target, new RemoteCookieJar(target), now),
    ).rejects.toThrow(/unable to read/);
  });
});
