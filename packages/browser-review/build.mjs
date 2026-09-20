// SPDX-License-Identifier: Apache-2.0
import { build } from "esbuild";
import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.join(here, "package.json"), "utf8"));
const outfile = path.join(here, "dist", "cli.js");

await build({
  entryPoints: [path.join(here, "src", "cli.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  sourcemap: true,
  // Runtime dependencies stay external so they resolve from node_modules and
  // keep their own licences and update path. Only @browser-review/shared, which
  // is never published, is pulled in.
  external: Object.keys(pkg.dependencies ?? {}),
  banner: { js: "#!/usr/bin/env node" },
  define: { __BROWSER_REVIEW_VERSION__: JSON.stringify(pkg.version) },
});

await chmod(outfile, 0o755);
console.log(`cli -> ${path.relative(process.cwd(), outfile)}`);
