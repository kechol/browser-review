// SPDX-License-Identifier: Apache-2.0
import path from "node:path";

export interface PathApi {
  isAbsolute(value: string): boolean;
  relative(from: string, to: string): string;
  resolve(...values: string[]): string;
  sep: string;
}

/** Compare path components rather than string prefixes. */
export function isPathWithin(root: string, candidate: string, api: PathApi = path): boolean {
  const relative = api.relative(api.resolve(root), api.resolve(candidate));
  return (
    relative === "" ||
    (!api.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${api.sep}`))
  );
}

/** Drive-relative paths such as C:foo depend on process state and are rejected. */
export function resolveScopedPath(root: string, value: string, api: PathApi = path): string | null {
  if (/^[A-Za-z]:[^\\/]/.test(value)) return null;
  const resolved = api.isAbsolute(value) ? api.resolve(value) : api.resolve(root, value);
  return isPathWithin(root, resolved, api) ? resolved : null;
}

/** Source hints are URLs/metadata, not local I/O paths. */
export function portableSourcePath(value: string): string {
  return value.replaceAll("\\", "/");
}
