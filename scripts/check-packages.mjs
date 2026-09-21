// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".output");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(path.join(output, "pack-check-"));
const packages = [
  ["packages/browser-review", ["dist/cli.js", "dist/overlay.js"]],
  ["packages/vite-plugin", ["dist/index.js", "dist/index.d.ts"]],
];
try {
  for (const [directory, entrypoints] of packages) {
    const manifest = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
    execFileSync("pnpm", ["--filter", manifest.name, "pack", "--pack-destination", scratch], {
      cwd: root,
      stdio: "pipe",
    });
    const filename = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
    const archive = path.join(scratch, filename);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    for (const file of ["LICENSE", "NOTICE", "README.md", "package.json", ...entrypoints]) {
      assert(entries.includes(`package/${file}`), `${manifest.name}: missing ${file}`);
    }
    for (const entry of entries) {
      assert(
        /^package\/(?:LICENSE|NOTICE|README\.md|package\.json|dist\/[^/]+)$/.test(entry),
        `${manifest.name}: unexpected published file ${entry}`,
      );
    }
    for (const file of ["LICENSE", "NOTICE"]) {
      const packed = execFileSync("tar", ["-xOf", archive, `package/${file}`], {
        encoding: "utf8",
      });
      assert.equal(
        packed,
        await readFile(path.join(root, file), "utf8"),
        `${file} must be current`,
      );
    }
    console.log(`package check passed: ${manifest.name}, documentation and entrypoints present`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
