// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "browser-review-versions-"));
  scratch.push(directory);
  for (const file of [
    "scripts/check-versions.mjs",
    "scripts/sync-plugin-version.mjs",
    "packages/browser-review/package.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".mcp.json",
    ...["open", "status", "close"].map((name) => `skills/${name}/SKILL.md`),
  ]) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    copyFileSync(path.join(root, file), path.join(directory, file));
  }
  return directory;
}

function check(directory: string) {
  return spawnSync(process.execPath, [path.join(directory, "scripts/check-versions.mjs")], {
    encoding: "utf8",
  });
}

test.each(["open", "status", "close"])("rejects a stale range in the %s skill", (name) => {
  const directory = fixture();
  expect(check(directory).status).toBe(0);
  const filename = path.join(directory, "skills", name, "SKILL.md");
  writeFileSync(
    filename,
    readFileSync(filename, "utf8").replace(/browser-review@[^\s`]+/g, "browser-review@^0.1.0"),
  );
  const result = check(directory);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`skills/${name}/SKILL.md`);
});

test.each(["0.3.0", "1.2.0"])("synchronizes CLI skills when releasing %s", (version) => {
  const directory = fixture();
  const filename = path.join(directory, "packages/browser-review/package.json");
  const pkg = JSON.parse(readFileSync(filename, "utf8"));
  pkg.version = version;
  writeFileSync(filename, JSON.stringify(pkg));
  expect(check(directory).status).toBe(1);
  execFileSync(process.execPath, [path.join(directory, "scripts/sync-plugin-version.mjs")]);
  expect(check(directory).status).toBe(0);
  const expected = version.startsWith("0.") ? "browser-review@^0.3.0" : "browser-review@^1.0.0";
  for (const name of ["open", "status", "close"]) {
    expect(readFileSync(path.join(directory, "skills", name, "SKILL.md"), "utf8")).toContain(
      expected,
    );
  }
});
