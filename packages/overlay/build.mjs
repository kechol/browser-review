// SPDX-License-Identifier: Apache-2.0
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, "..", "browser-review", "dist", "overlay.js");
await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(here, "src", "index.ts")],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "inline",
  banner: { js: "/* browser-review overlay — SPDX-License-Identifier: Apache-2.0 */" },
});

console.log(`overlay -> ${path.relative(process.cwd(), outfile)}`);
