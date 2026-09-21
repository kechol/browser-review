// SPDX-License-Identifier: Apache-2.0
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const name of ["LICENSE", "NOTICE"]) {
  await copyFile(path.join(root, name), path.join(process.cwd(), name));
}
