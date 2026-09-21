// SPDX-License-Identifier: Apache-2.0
//
// Run straight after `changeset version`. The plugin manifest, the marketplace
// entry and the npx ranges in .mcp.json and CLI skills restate the package's
// version; this copies it across so the release pull request carries them all.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
const write = (rel, value) =>
  writeFileSync(path.join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`);

const pkg = read("packages/browser-review/package.json");
const [major, minor] = pkg.version.split(".");
// Before 1.0 a minor bump is allowed to break things, so the range tracks the
// minor rather than the major.
const range = major === "0" ? `^0.${minor}.0` : `^${major}.0.0`;

const plugin = read(".claude-plugin/plugin.json");
plugin.version = pkg.version;
write(".claude-plugin/plugin.json", plugin);

const marketplace = read(".claude-plugin/marketplace.json");
for (const entry of marketplace.plugins ?? []) {
  if (entry.name === plugin.name) entry.version = pkg.version;
}
write(".claude-plugin/marketplace.json", marketplace);

const mcp = read(".mcp.json");
const args = mcp.mcpServers?.review?.args ?? [];
mcp.mcpServers.review.args = args.map((arg) =>
  typeof arg === "string" && arg.startsWith(`${pkg.name}@`) ? `${pkg.name}@${range}` : arg,
);
write(".mcp.json", mcp);

for (const name of ["open", "status", "close"]) {
  const filename = path.join(ROOT, "skills", name, "SKILL.md");
  const source = readFileSync(filename, "utf8");
  writeFileSync(filename, source.replace(/browser-review@[^\s`]+/g, `${pkg.name}@${range}`));
}

console.log(`synced plugin metadata to ${pkg.version} (npx range ${range})`);
