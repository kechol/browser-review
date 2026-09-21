// SPDX-License-Identifier: Apache-2.0
//
// browser-review binds only to loopback. Its one outbound capability is the
// user-selected proxy upstream, implemented in two narrowly scoped modules.
// This fails CI if other shipped source grows a network primitive or if a
// fixed non-loopback destination appears anywhere in executable source.

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

/** Network primitives and the only shipped modules allowed to import them. */
const NETWORK_IMPORT =
  /(?:from\s+|\b(?:require|import)\(\s*)["'](?:node:)?(https|dns(?:\/promises)?|dgram|tls|net)["']/;
const NETWORK_IMPORT_ALLOWLIST = new Map([
  ["packages/browser-review/src/proxy.ts", new Set(["https", "net"])],
  ["packages/browser-review/src/upstream.ts", new Set(["dns", "dns/promises", "net"])],
]);

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

    const networkImport = line.match(NETWORK_IMPORT)?.[1];
    if (networkImport && !NETWORK_IMPORT_ALLOWLIST.get(rel)?.has(networkImport)) {
      problems.push(`${at}: imports network module "${networkImport}" outside the proxy boundary`);
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

// proxy.ts connects through node:http/node:https, and upstream.ts resolves and
// pins the hostname taken from the user-selected URL. A fixed destination
// would have to appear as a literal above, which is the other half of this
// check.

if (problems.length > 0) {
  console.error("browser-review has an outbound capability outside its proxy boundary.\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nIf one of these is a false positive — prose in a comment, say — reword it " +
      "rather than loosening the check.",
  );
  process.exit(1);
}

console.log(
  "no-egress check passed: network primitives are scoped and no fixed remote host exists.",
);
