// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TargetError, parseTarget } from "../src/cli.js";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-review-cli-"));
  fs.writeFileSync(path.join(dir, "page.html"), "<h1>hi</h1>");
  fs.writeFileSync(path.join(dir, "notes.txt"), "hi");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("parseTarget", () => {
  it("accepts a local html file and makes the path absolute", () => {
    expect(parseTarget("page.html", dir)).toEqual({
      mode: "html-file",
      target: path.join(dir, "page.html"),
    });
  });

  it("accepts a localhost URL as a proxy target", () => {
    expect(parseTarget("http://localhost:5173", dir)).toEqual({
      mode: "proxy",
      target: "http://localhost:5173",
    });
  });

  it("remembers a path beyond the root so the review opens there", () => {
    expect(parseTarget("http://127.0.0.1:3000/admin?tab=users", dir)).toEqual({
      mode: "proxy",
      target: "http://127.0.0.1:3000",
      entryPath: "/admin?tab=users",
    });
  });

  it("refuses a remote origin, and says why", () => {
    expect(() => parseTarget("http://example.com", dir)).toThrow(TargetError);
    expect(() => parseTarget("http://example.com", dir)).toThrow(/not a local host/);
  });

  it("accepts an explicitly allowed remote HTTPS origin and keeps its entry path", () => {
    expect(
      parseTarget("https://staging.example.test/admin?tab=users", dir, { allowRemote: true }),
    ).toEqual({
      mode: "proxy",
      target: "https://staging.example.test",
      entryPath: "/admin?tab=users",
    });
  });

  it("accepts local HTTPS but still rejects remote HTTP and URL credentials", () => {
    expect(() => parseTarget("http://staging.example.test", dir, { allowRemote: true })).toThrow(
      /must use https/,
    );
    expect(() =>
      parseTarget("https://user:secret@staging.example.test", dir, { allowRemote: true }),
    ).toThrow(/username or password/);
    expect(parseTarget("https://localhost:5173", dir)).toEqual({
      mode: "proxy",
      target: "https://localhost:5173",
    });
  });

  it("refuses a file that is not HTML", () => {
    expect(() => parseTarget("notes.txt", dir)).toThrow(/not an HTML file/);
  });

  it("refuses a file that is not there", () => {
    expect(() => parseTarget("missing.html", dir)).toThrow(/no such file/);
  });
});

it("preserves a root query, fragment and IPv6 loopback target", () => {
  expect(parseTarget("http://[::1]:5173/?tab=users#heading", dir)).toEqual({
    mode: "proxy",
    target: "http://[::1]:5173",
    entryPath: "/?tab=users#heading",
  });
});
