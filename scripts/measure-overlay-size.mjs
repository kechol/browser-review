// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const file = process.argv[2] ?? "packages/browser-review/dist/overlay.js";
const baseline = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
if (baseline !== undefined && !Number.isSafeInteger(baseline)) {
  throw new Error("baseline must be an integer number of gzip bytes");
}
const source = readFileSync(file);
const gzip = gzipSync(source, { level: 9 }).byteLength;
process.stdout.write(
  `${JSON.stringify({ file, raw: source.byteLength, gzip, ...(baseline === undefined ? {} : { baseline, delta: gzip - baseline }) })}\n`,
);
