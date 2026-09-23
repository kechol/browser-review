// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathWithin, portableSourcePath, resolveScopedPath } from "../src/path-util.js";
import { stateDirFrom } from "../src/paths.js";

describe("state directory", () => {
  it("uses ~/.browser-review when XDG_STATE_HOME is absent or blank", () => {
    expect(stateDirFrom(undefined, "/tmp/browser-review-home")).toBe(
      path.join("/tmp/browser-review-home", ".browser-review"),
    );
    expect(stateDirFrom("", "/tmp/browser-review-home")).toBe(
      path.join("/tmp/browser-review-home", ".browser-review"),
    );
    expect(stateDirFrom("  ", "/tmp/browser-review-home")).toBe(
      path.join("/tmp/browser-review-home", ".browser-review"),
    );
  });

  it("keeps an explicit XDG_STATE_HOME override", () => {
    expect(stateDirFrom("/tmp/isolated-state", "/tmp/browser-review-home")).toBe(
      path.join("/tmp/isolated-state", "browser-review"),
    );
  });
});

describe("Windows path boundaries", () => {
  const win = path.win32;

  it("accepts absolute, mixed-separator, space, and Japanese child paths", () => {
    const root = "C:\\Review Projects\\見本";
    expect(isPathWithin(root, "C:\\Review Projects\\見本\\src\\App.tsx", win)).toBe(true);
    expect(isPathWithin(root, "C:/Review Projects/見本/src/App.tsx", win)).toBe(true);
    expect(resolveScopedPath(root, "src\\日本語 file.tsx", win)).toBe(
      "C:\\Review Projects\\見本\\src\\日本語 file.tsx",
    );
  });

  it("rejects sibling prefixes, traversal, drive-relative paths, and another drive", () => {
    const root = "C:\\repo";
    expect(isPathWithin(root, "C:\\repo-other\\file.ts", win)).toBe(false);
    expect(resolveScopedPath(root, "..\\outside.ts", win)).toBeNull();
    expect(resolveScopedPath(root, "C:relative.ts", win)).toBeNull();
    expect(resolveScopedPath(root, "D:\\repo\\file.ts", win)).toBeNull();
  });

  it("keeps UNC shares isolated", () => {
    const root = "\\\\server\\share\\repo";
    expect(isPathWithin(root, "\\\\server\\share\\repo\\src\\app.ts", win)).toBe(true);
    expect(isPathWithin(root, "\\\\server\\share\\repo-old\\app.ts", win)).toBe(false);
    expect(isPathWithin(root, "\\\\other\\share\\repo\\app.ts", win)).toBe(false);
  });

  it("uses portable slashes only for source metadata", () => {
    expect(portableSourcePath("src\\components\\Button.tsx")).toBe("src/components/Button.tsx");
  });
});
