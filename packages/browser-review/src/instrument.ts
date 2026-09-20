// SPDX-License-Identifier: Apache-2.0
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** Elements that are never clickable in the page, so never worth tagging. */
const SKIP_TAGS = new Set([
  "html",
  "head",
  "meta",
  "link",
  "title",
  "base",
  "script",
  "style",
  "template",
  "noscript",
]);

const ATTR = "data-review-src";

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Tag every element in a served HTML document with the source position it came
 * from, so the overlay can hand the agent an exact file and line.
 *
 * The edit is done by splicing into the original text at the offsets parse5
 * reports, rather than re-serializing the parsed tree. Re-serialization would
 * normalize the markup, and the file on disk — the thing the agent is about to
 * edit — would no longer line up with what the browser showed.
 */
export function instrumentHtml(html: string, relPath: string): string {
  let document: DefaultTreeAdapterMap["document"];
  try {
    // Name the tree adapter explicitly: without it the generic falls back to the
    // unresolved base map and every node comes out as `unknown`.
    document = parse<DefaultTreeAdapterMap>(html, { sourceCodeLocationInfo: true });
  } catch {
    return html;
  }

  type Insert = { offset: number; text: string };
  const inserts: Insert[] = [];

  const visit = (node: Node): void => {
    if (isElement(node)) {
      const tagName = node.tagName.toLowerCase();
      const loc = node.sourceCodeLocation;
      const startTag = loc?.startTag;
      const alreadyTagged = node.attrs.some((a) => a.name === ATTR);
      if (startTag && !SKIP_TAGS.has(tagName) && !alreadyTagged) {
        // `<` plus the tag name; whatever follows is attributes or `>`.
        const offset = startTag.startOffset + 1 + tagName.length;
        const value = `${relPath}:${loc!.startLine}:${loc!.startCol}`;
        inserts.push({ offset, text: ` ${ATTR}="${escapeAttr(value)}"` });
      }
    }
    const children = (node as { childNodes?: Node[] }).childNodes;
    if (children) for (const child of children) visit(child);
    const content = (node as { content?: Node | undefined }).content;
    if (content) visit(content);
  };
  visit(document);

  // Apply back to front so earlier offsets stay valid.
  inserts.sort((a, b) => b.offset - a.offset);
  let out = html;
  for (const insert of inserts) {
    out = out.slice(0, insert.offset) + insert.text + out.slice(insert.offset);
  }
  return out;
}

/**
 * Put the overlay loader into a document.
 *
 * Configuration rides on `data-` attributes of the external script tag rather
 * than an inline script, so a page served with `script-src 'self'` keeps
 * working without us having to weaken its policy.
 */
export function injectOverlay(html: string, scriptUrl: string, config: unknown): string {
  const tag =
    `<script src="${escapeAttr(scriptUrl)}" defer ` +
    `data-browser-review="${escapeAttr(JSON.stringify(config))}"></script>`;

  const closingBody = html.toLowerCase().lastIndexOf("</body>");
  if (closingBody !== -1) {
    return html.slice(0, closingBody) + tag + html.slice(closingBody);
  }
  const closingHtml = html.toLowerCase().lastIndexOf("</html>");
  if (closingHtml !== -1) {
    return html.slice(0, closingHtml) + tag + html.slice(closingHtml);
  }
  return html + tag;
}
