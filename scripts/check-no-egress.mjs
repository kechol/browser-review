// SPDX-License-Identifier: Apache-2.0
//
// browser-review promises that it never talks to anything but this machine.
// That promise is only worth what it can be checked against, so this runs in
// CI and fails the build if the shipped source grows a way out.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [
  "packages/browser-review/src",
  "packages/overlay/src",
  "packages/shared/src",
  "packages/vite-plugin/src",
  "scripts",
];

// A loopback name, optionally with a port: a literal one, a template hole
// filled from the session's own port, or `PORT` standing in inside help text.
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::(?:\d+|\$\{[^}]*\}|PORT))?$/;

/** Modules that exist to reach the network in ways we do not need. */
const FORBIDDEN_IMPORTS = [
  /from\s+["'](?:node:)?https["']/,
  /from\s+["'](?:node:)?dns["']/,
  /from\s+["'](?:node:)?dgram["']/,
  /from\s+["'](?:node:)?tls["']/,
  /\brequire\(\s*["'](?:node:)?https["']\s*\)/,
];

/** Ways a browser page can call home. The overlay uses none of them. */
const FORBIDDEN_CALLS = [
  /\bXMLHttpRequest\b/,
  /\bnavigator\s*\.\s*sendBeacon\b/,
  /\bimportScripts\s*\(/,
];

const URL_LITERAL = /\bhttps?:\/\/([^\s"'`)\\<>]+)?/g;

function files(dir) {
  const abs = path.join(ROOT, dir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(abs, entry);
    if (statSync(full).isDirectory()) return files(path.join(dir, entry));
    return /\.(?:ts|mjs|js)$/.test(entry) ? [path.join(dir, entry)] : [];
  });
}

const problems = [];

for (const rel of SCAN_DIRS.flatMap(files)) {
  const source = readFileSync(path.join(ROOT, rel), "utf8");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`;

    for (const pattern of FORBIDDEN_IMPORTS) {
      if (pattern.test(line)) problems.push(`${at}: imports a module used to reach the network`);
    }
    for (const pattern of FORBIDDEN_CALLS) {
      if (pattern.test(line)) problems.push(`${at}: uses a browser API that can send data out`);
    }

    for (const match of line.matchAll(URL_LITERAL)) {
      const authority = match[1];
      // A bare `http://` inside a sentence is prose, not a destination.
      if (!authority) continue;
      // `${...}` means the host is built at runtime from a session's own port.
      if (authority.startsWith("${")) continue;
      // Take the authority, then drop the sentence punctuation that a prose
      // mention leaves clinging to it.
      const host = authority
        .split(/[/?#]/)[0]
        .replace(/[.,;:)\]]+$/, (tail) => (/^\d+$/.test(tail) ? tail : ""));
      if (LOOPBACK.test(host)) continue;
      problems.push(`${at}: mentions a non-loopback URL host "${host}"`);
    }
  });
}

// The review server reaches the upstream dev server through node:http, and only
// ever with a hostname taken from the URL the user passed. Anything that calls
// out with a hostname the user did not supply would have to appear as a literal
// above, which is what this check exists to catch.

if (problems.length > 0) {
  console.error("browser-review must not talk to anything but this machine.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nIf one of these is a false positive — prose in a comment, say — reword it " +
      "rather than loosening the check.",
  );
  process.exit(1);
}

console.log("no-egress check passed: every URL host in the source is loopback.");
