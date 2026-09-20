// SPDX-License-Identifier: Apache-2.0
import type { Annotation, AnnotationDraft, Bbox, SourceHint } from "@browser-review/shared";
import { OUTER_HTML_HEAD_LIMIT } from "@browser-review/shared";
import { ulid } from "./ulid.js";

const MAX_COMMENT = 4_000;
const MAX_HINTS = 8;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Remove `value` attributes from a markup fragment.
 *
 * The overlay already strips them, but the WebSocket is an input from the page
 * and the server must not rely on the page having behaved. What the user typed
 * into a form is none of the agent's business.
 */
export function stripValueAttributes(html: string): string {
  return html
    .replace(/\svalue\s*=\s*"[^"]*"/gi, " value=\"…\"")
    .replace(/\svalue\s*=\s*'[^']*'/gi, " value=\"…\"")
    .replace(/\svalue\s*=\s*[^\s">]+/gi, " value=\"…\"");
}

function sanitizeBbox(value: unknown): Bbox {
  const b = (value ?? {}) as Record<string, unknown>;
  return { x: num(b["x"]), y: num(b["y"]), width: num(b["width"]), height: num(b["height"]) };
}

function sanitizeHint(raw: unknown): SourceHint | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  const confidence = Math.min(1, Math.max(0, num(h["confidence"])));
  switch (h["kind"]) {
    case "loc": {
      const file = str(h["file"], 512);
      const line = Math.trunc(num(h["line"]));
      if (!file || line <= 0) return null;
      const via = h["via"];
      const hint: SourceHint = {
        kind: "loc",
        file,
        line,
        confidence,
        via:
          via === "data-review-src" ||
          via === "fiber-debugsource" ||
          via === "svelte-meta" ||
          via === "parse5"
            ? via
            : "data-review-src",
      };
      const col = Math.trunc(num(h["col"]));
      if (col > 0) hint.col = col;
      return hint;
    }
    case "component": {
      const chain = Array.isArray(h["chain"])
        ? h["chain"].map((c) => str(c, 128)).filter(Boolean).slice(0, 12)
        : [];
      return chain.length ? { kind: "component", chain, confidence } : null;
    }
    case "data": {
      const attrs: Record<string, string> = {};
      const source = h["attrs"];
      if (source && typeof source === "object") {
        for (const [k, v] of Object.entries(source as Record<string, unknown>).slice(0, 12)) {
          attrs[str(k, 64)] = str(v, 256);
        }
      }
      return Object.keys(attrs).length ? { kind: "data", attrs, confidence } : null;
    }
    case "css": {
      const file = str(h["file"], 512);
      const selectorText = str(h["selectorText"], 512);
      if (!file && !selectorText) return null;
      const hint: SourceHint = { kind: "css", file, selectorText, confidence };
      const line = Math.trunc(num(h["line"]));
      if (line > 0) hint.line = line;
      return hint;
    }
    case "selector": {
      const value = str(h["value"], 512);
      if (!value) return null;
      const hint: SourceHint = {
        kind: "selector",
        value,
        bbox: sanitizeBbox(h["bbox"]),
        confidence,
      };
      const text = str(h["text"], 256);
      if (text) hint.text = text;
      const ariaLabel = str(h["ariaLabel"], 256);
      if (ariaLabel) hint.ariaLabel = ariaLabel;
      return hint;
    }
    default:
      return null;
  }
}

/** Build a stored annotation from whatever the page sent, trusting none of it. */
export function createAnnotation(
  sessionId: string,
  draft: AnnotationDraft,
  now = new Date(),
): Annotation {
  const page = (draft.page ?? {}) as Partial<AnnotationDraft["page"]>;
  const element = (draft.element ?? {}) as Partial<AnnotationDraft["element"]>;
  const hints = Array.isArray(draft.sourceHints) ? draft.sourceHints : [];

  const sourceHints = hints
    .map(sanitizeHint)
    .filter((h): h is SourceHint => h !== null)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_HINTS);

  return {
    id: `a_${ulid(now.getTime())}`,
    sessionId,
    status: "pending",
    comment: str(draft.comment, MAX_COMMENT).trim(),
    page: {
      url: str(page.url, 2_048),
      path: str(page.path, 1_024),
      title: str(page.title, 512),
    },
    element: {
      outerHtmlHead: stripValueAttributes(str(element.outerHtmlHead, OUTER_HTML_HEAD_LIMIT)),
      tag: str(element.tag, 64).toLowerCase(),
    },
    sourceHints,
    createdAt: now.toISOString(),
    questions: [],
  };
}

/** A one-line description used in listings and hook output. */
export function summarizeHint(hint: SourceHint): string {
  switch (hint.kind) {
    case "loc":
      return `${hint.file}:${hint.line}${hint.col ? `:${hint.col}` : ""} (${hint.via})`;
    case "component":
      return hint.chain.join(" > ");
    case "data":
      return Object.entries(hint.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
    case "css":
      return `${hint.selectorText} @ ${hint.file}${hint.line ? `:${hint.line}` : ""}`;
    case "selector":
      return hint.value;
  }
}
