// SPDX-License-Identifier: Apache-2.0
//
// Everything browser-review ships has to be usable by whoever installs it, so
// the runtime dependency tree is restricted to permissive licences. Run against
// the published packages only: dev tooling never reaches a user's machine.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
]);

const PUBLISHED = ["browser-review", "@browser-review/vite-plugin"];

/** `(MIT OR Apache-2.0)` and `MIT AND ISC` both have to be taken apart. */
function terms(expression) {
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|WITH)\s+/i)
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * `not-installed` is a real answer, not a failure: `ws` lists optional native
 * speed-ups and the MCP SDK lists an optional validator peer. A dependency
 * nobody installs ships to nobody.
 */
function licenseOf(name) {
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8"),
    );
  } catch {
    return "not-installed";
  }
  const license = manifest.license ?? manifest.licenses?.[0];
  if (!license) return null;
  return typeof license === "string" ? license : (license.type ?? null);
}

function treeFor(pkg) {
  const json = execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--workspace", pkg], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(json);
}

const seen = new Map();
const visited = new Set();

function collect(node) {
  for (const [name, child] of Object.entries(node?.dependencies ?? {})) {
    if (visited.has(name)) continue;
    visited.add(name);
    // Our own workspace packages carry the project licence; walk through them
    // to their dependencies without recording them as third party.
    const ours = name === "browser-review" || name.startsWith("@browser-review/");
    if (!ours) seen.set(name, licenseOf(name));
    collect(child);
  }
}

for (const pkg of PUBLISHED) {
  // `npm ls --workspace` still reports the monorepo root as the top node, with
  // every hoisted package beside ours. Start from the workspace's own entry so
  // that dev tooling and anything left over from a previous install stay out.
  const tree = treeFor(pkg);
  const own = tree.dependencies?.[pkg];
  if (!own) {
    console.error(`could not find ${pkg} in the dependency tree; is it installed?`);
    process.exit(1);
  }
  collect(own);
}

const problems = [];
for (const [name, license] of [...seen].sort()) {
  if (license === "not-installed") continue;
  if (!license) {
    problems.push(`${name}: no license field found`);
    continue;
  }
  const bad = terms(license).filter((term) => !ALLOWED.has(term));
  // An expression offering a choice is fine as long as one option is allowed.
  if (/\bOR\b/i.test(license) && bad.length < terms(license).length) continue;
  if (bad.length > 0) problems.push(`${name}: ${license}`);
}

if (problems.length > 0) {
  console.error("Runtime dependencies must be permissively licensed.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nAllowed: ${[...ALLOWED].join(", ")}`);
  process.exit(1);
}

console.log(`license check passed: ${seen.size} runtime dependencies, all permissive.`);
