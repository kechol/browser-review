// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
    if (manifest.name === "browser-review") {
      execFileSync("tar", ["-xzf", archive, "-C", scratch]);
      // Reuse locked runtime dependencies without downloading during package checks.
      await symlink(
        path.join(root, directory, "node_modules"),
        path.join(scratch, "package", "node_modules"),
      );
      const cli = path.join(scratch, "package", manifest.bin["browser-review"]);
      const bin = path.join(scratch, "bin");
      await mkdir(bin);
      const link = path.join(bin, "browser-review");
      await symlink(cli, link);
      const brewLink = path.join(scratch, "browser-review");
      await symlink(link, brewLink);
      for (const entry of [cli, link, brewLink]) {
        const help = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
        assert.match(help, /browser-review open/, `${entry}: missing CLI help`);
        const status = execFileSync(process.execPath, [entry, "status", "--json"], {
          encoding: "utf8",
          env: { ...process.env, XDG_STATE_HOME: path.join(scratch, "state") },
        });
        assert.deepEqual(JSON.parse(status), { sessions: [] });
      }
      const imported = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", `await import(${JSON.stringify(cli)})`],
        { encoding: "utf8" },
      );
      assert.equal(imported, "", "importing the CLI must not execute commands");
    }
    console.log(`package check passed: ${manifest.name}, documentation and entrypoints present`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
