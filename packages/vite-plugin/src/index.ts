// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { parse } from "@babel/parser";

export interface BrowserReviewOptions {
  /**
   * Which files to tag. Defaults to `.jsx` and `.tsx` outside `node_modules`.
   */
  include?: (id: string) => boolean;
  /** Project root that emitted paths are relative to. Defaults to Vite's root. */
  root?: string;
  /**
   * Tag elements even when Vite is not in development mode. Off by default:
   * shipping source paths to production would leak your directory layout.
   */
  applyInBuild?: boolean;
}

const ATTR = "data-review-src";
const DEFAULT_EXTENSIONS = new Set([".jsx", ".tsx"]);

function defaultInclude(id: string): boolean {
  if (id.includes("/node_modules/")) return false;
  const clean = id.split("?")[0] ?? id;
  return DEFAULT_EXTENSIONS.has(path.extname(clean));
}

interface JsxOpeningElement {
  type: string;
  name: { type: string; end?: number | null };
  attributes: Array<{ type: string; name?: { name?: string } }>;
  loc?: { start: { line: number; column: number } } | null;
}

function isTaggable(node: JsxOpeningElement): boolean {
  // A fragment has no name to hang an attribute on, and nothing useful to say.
  if (node.name.type === "JSXFragment") return false;
  if (typeof node.name.end !== "number") return false;
  return !node.attributes.some(
    (attr) => attr.type === "JSXAttribute" && attr.name?.name === ATTR,
  );
}

function walk(node: unknown, found: JsxOpeningElement[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record["type"] === "JSXOpeningElement") found.push(node as JsxOpeningElement);
  for (const key of Object.keys(record)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    walk(record[key], found);
  }
}

/**
 * Add `data-review-src="file:line:col"` to every JSX element in a source file.
 *
 * The attribute is spliced into the original text at the offset Babel reports,
 * rather than regenerating the file from its AST. Regenerating would rewrite
 * every line and hand the next plugin in the chain a file whose positions no
 * longer match anything the developer wrote.
 */
export function tagSource(code: string, relPath: string): string {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: "module",
      errorRecovery: true,
      plugins: ["jsx", "typescript", "decorators-legacy", "importAttributes"],
    });
  } catch {
    // A file we cannot parse is a file we leave alone.
    return code;
  }

  const elements: JsxOpeningElement[] = [];
  walk(ast.program.body, elements);

  const inserts = elements
    .filter(isTaggable)
    .map((node) => ({
      offset: node.name.end as number,
      text: ` ${ATTR}="${relPath}:${node.loc?.start.line ?? 0}:${(node.loc?.start.column ?? 0) + 1}"`,
    }))
    .sort((a, b) => b.offset - a.offset);

  let out = code;
  for (const insert of inserts) {
    out = out.slice(0, insert.offset) + insert.text + out.slice(insert.offset);
  }
  return out;
}

/** Minimal shape of the Vite plugin object, so `vite` stays a peer dependency. */
interface VitePluginLike {
  name: string;
  enforce?: "pre" | "post";
  apply?: "serve" | "build";
  configResolved?: (config: { root: string }) => void;
  transform?: (code: string, id: string) => { code: string; map: null } | null;
}

/**
 * Vite plugin that lets browser-review jump from a clicked element straight to
 * the line of JSX that produced it.
 *
 * React 19 no longer attaches `_debugSource` to fibers, so the DOM alone does
 * not say where an element came from. This puts that back, as an attribute the
 * overlay can read with no framework knowledge at all.
 */
export default function browserReview(options: BrowserReviewOptions = {}): VitePluginLike {
  const include = options.include ?? defaultInclude;
  let root = options.root ?? process.cwd();

  return {
    name: "browser-review",
    enforce: "pre",
    ...(options.applyInBuild ? {} : { apply: "serve" as const }),
    configResolved(config) {
      if (!options.root) root = config.root;
    },
    transform(code, id) {
      if (!include(id)) return null;
      const clean = id.split("?")[0] ?? id;
      const relPath = path.relative(root, clean) || path.basename(clean);
      const tagged = tagSource(code, relPath);
      if (tagged === code) return null;
      // Inserts never add or remove a line, so existing positions still hold
      // and Vite can keep using the original mapping.
      return { code: tagged, map: null };
    },
  };
}
