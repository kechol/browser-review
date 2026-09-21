// SPDX-License-Identifier: Apache-2.0
//
// The plugin starts the published package through npx, so a plugin release and
// a package release have to move together. This fails the build when they drift.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

const plugin = read(".claude-plugin/plugin.json");
const marketplace = read(".claude-plugin/marketplace.json");
const pkg = read("packages/browser-review/package.json");
const mcp = read(".mcp.json");

const problems = [];
const [major, minor] = pkg.version.split(".");
const expected = major === "0" ? `^0.${minor}.0` : `^${major}.0.0`;

if (plugin.version !== pkg.version) {
  problems.push(
    `.claude-plugin/plugin.json is ${plugin.version} but packages/browser-review is ${pkg.version}. ` +
      "Bump both in the same pull request.",
  );
}

const entry = marketplace.plugins?.find((p) => p.name === plugin.name);
if (!entry) {
  problems.push(`.claude-plugin/marketplace.json does not list "${plugin.name}".`);
} else if (entry.version !== plugin.version) {
  problems.push(
    `marketplace.json lists ${plugin.name}@${entry.version} but plugin.json says ${plugin.version}.`,
  );
}

const args = mcp.mcpServers?.review?.args ?? [];
const spec = args.find((arg) => typeof arg === "string" && arg.startsWith(`${pkg.name}@`));
if (!spec) {
  problems.push(`.mcp.json does not start ${pkg.name}; the plugin would have no tools.`);
} else {
  const range = spec.slice(pkg.name.length + 1);
  if (range !== expected) {
    problems.push(
      `.mcp.json pins ${spec}, but version ${pkg.version} wants ${pkg.name}@${expected}. ` +
        "Before 1.0 a minor bump is a breaking change, so the range tracks the minor.",
    );
  }
}

for (const name of ["open", "status", "close"]) {
  const filename = `skills/${name}/SKILL.md`;
  const source = readFileSync(path.join(ROOT, filename), "utf8");
  const specs = source.match(/browser-review@[^\s`]+/g) ?? [];
  if (specs.length === 0 || specs.some((value) => value !== `${pkg.name}@${expected}`)) {
    problems.push(
      `${filename} must invoke ${pkg.name}@${expected}. Run pnpm run version-packages when releasing.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Version metadata is out of step:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`version check passed: plugin, marketplace and package all at ${pkg.version}.`);
