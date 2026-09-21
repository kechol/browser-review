// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Use the exact registry archive: repacking a checkout can change its checksum.
// This release helper reads local files only and never writes to a tap itself.
export async function generateFormula(archive) {
  const filename = path.resolve(archive);
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOf", filename, "package/package.json"], { encoding: "utf8" }),
  );
  if (
    manifest.name !== "browser-review" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version) ||
    manifest.license !== "Apache-2.0" ||
    manifest.bin?.["browser-review"] !== "./dist/cli.js"
  ) {
    throw new Error("Expected a stable browser-review release with its CLI and Apache-2.0 license");
  }
  const entries = execFileSync("tar", ["-tzf", filename], { encoding: "utf8" }).split("\n");
  for (const entry of ["dist/cli.js", "dist/overlay.js", "LICENSE", "NOTICE", "README.md"]) {
    if (!entries.includes(`package/${entry}`)) throw new Error(`Missing package/${entry}`);
  }
  const sha256 = createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
  const template = await readFile(
    path.join(root, "packaging/homebrew/browser-review.rb.in"),
    "utf8",
  );
  return template.replaceAll("@VERSION@", manifest.version).replaceAll("@SHA256@", sha256);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [archive, ...extra] = process.argv.slice(2);
  if (!archive || extra.length) {
    throw new Error("Usage: pnpm homebrew:formula <published-browser-review.tgz>");
  }
  const formula = await generateFormula(archive);
  const output = path.join(root, ".output/homebrew/browser-review.rb");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, formula);
  console.log(`Generated ${path.relative(root, output)}; review before copying to the tap.`);
}
