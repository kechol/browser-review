// SPDX-License-Identifier: Apache-2.0
import type { SourceHint } from "@browser-review/shared";

/**
 * Class names that say how something looks rather than what it is. Putting one
 * in a selector produces a selector that matches half the page, which is worse
 * than no hint at all.
 */
const UTILITY_CLASS = new RegExp(
  "^(?:" +
    "[mp][trblxyse]?-|" +
    "(?:text|bg|border|ring|fill|stroke|from|via|to|shadow|rounded|opacity)-|" +
    "(?:flex|grid|inline|block|hidden|absolute|relative|fixed|sticky|static)$|" +
    "(?:w|h|min-w|min-h|max-w|max-h|gap|space|col|row|order|z|top|left|right|bottom)-|" +
    "(?:items|justify|self|content|place)-|" +
    "(?:font|leading|tracking|align|whitespace|truncate|uppercase|lowercase|capitalize)-|" +
    "(?:sm|md|lg|xl|2xl|hover|focus|active|dark|group|peer):" +
    ")",
);

const DATA_ATTRS = [
  "data-testid",
  "data-test",
  "data-test-id",
  "data-cy",
  "data-qa",
  "data-component",
  "data-name",
];

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function isUniqueId(id: string): boolean {
  return safe(() => document.querySelectorAll(`#${cssEscape(id)}`).length === 1) ?? false;
}

function distinctiveClass(el: Element): string | null {
  for (const name of Array.from(el.classList)) {
    if (name.length < 4) continue;
    if (UTILITY_CLASS.test(name)) continue;
    if (/^[0-9]/.test(name)) continue;
    return name;
  }
  return null;
}

function nthOfType(el: Element): number | null {
  const parent = el.parentElement;
  if (!parent) return null;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (siblings.length < 2) return null;
  return siblings.indexOf(el) + 1;
}

/** A selector that identifies this element and, where possible, says something about it. */
export function uniqueSelector(el: Element): string {
  if (el.id && isUniqueId(el.id)) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement &&
    depth < 256
  ) {
    const tag = current.tagName.toLowerCase();

    const dataAttr = DATA_ATTRS.find((name) => current!.hasAttribute(name));
    if (dataAttr) {
      const candidate = `${tag}[${dataAttr}="${cssEscape(current.getAttribute(dataAttr) ?? "")}"]`;
      if (safe(() => document.querySelectorAll(candidate).length === 1)) {
        parts.unshift(candidate);
        break;
      }
    }
    if (current.id && isUniqueId(current.id)) {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }

    let part = tag;
    const cls = distinctiveClass(current);
    if (cls) part += `.${cssEscape(cls)}`;
    const index = nthOfType(current);
    if (index !== null) part += `:nth-of-type(${index})`;
    parts.unshift(part);

    current = current.parentElement;
    depth += 1;
  }

  return parts.join(" > ") || el.tagName.toLowerCase();
}

/* ----------------------------------------------------- strategy 1: attribute */

function fromReviewSrcAttribute(el: Element): SourceHint | null {
  const holder = el.closest("[data-review-src]");
  const raw = holder?.getAttribute("data-review-src");
  if (!raw) return null;
  // `path/to/file.tsx:12:4`, where the path may itself contain colons on no
  // sane system but a drive letter on one.
  const match = /^(.*):(\d+):(\d+)$/.exec(raw) ?? /^(.*):(\d+)$/.exec(raw);
  if (!match) return null;
  const hint: SourceHint = {
    kind: "loc",
    file: match[1]!,
    line: Number(match[2]),
    confidence: 0.95,
    via: "data-review-src",
  };
  if (match[3]) hint.col = Number(match[3]);
  return hint;
}

/* --------------------------------------------------------- strategy 2: React */

interface Fiber {
  type?: unknown;
  elementType?: unknown;
  return?: Fiber;
  _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number };
  _debugOwner?: Fiber;
  memoizedProps?: Record<string, unknown>;
}

function fiberOf(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (el as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
}

function componentName(fiber: Fiber): string | null {
  const type = (fiber.type ?? fiber.elementType) as
    | { displayName?: string; name?: string }
    | string
    | null
    | undefined;
  if (!type) return null;
  if (typeof type === "string") return null; // a host element, not a component
  return type.displayName ?? type.name ?? null;
}

/**
 * React stops emitting `_debugSource` in React 19, so this returns nothing on a
 * modern React app. That is why `@browser-review/vite-plugin` exists: it puts
 * the same information into `data-review-src`, which nothing can take away.
 */
function fromReactDebugSource(el: Element): SourceHint | null {
  let fiber = fiberOf(el);
  let depth = 0;
  while (fiber && depth < 30) {
    const source = fiber._debugSource;
    if (source?.fileName && typeof source.lineNumber === "number") {
      const hint: SourceHint = {
        kind: "loc",
        file: source.fileName,
        line: source.lineNumber,
        confidence: 0.9,
        via: "fiber-debugsource",
      };
      if (typeof source.columnNumber === "number") hint.col = source.columnNumber;
      return hint;
    }
    fiber = fiber._debugOwner ?? fiber.return ?? null;
    depth += 1;
  }
  return null;
}

/* ---------------------------------------------- strategy 3: component naming */

function fromSvelteMeta(el: Element): SourceHint | null {
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 20) {
    const meta = (
      current as unknown as {
        __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } };
      }
    ).__svelte_meta;
    if (meta?.loc?.file && typeof meta.loc.line === "number") {
      const hint: SourceHint = {
        kind: "loc",
        file: meta.loc.file,
        line: meta.loc.line,
        confidence: 0.9,
        via: "svelte-meta",
      };
      if (typeof meta.loc.column === "number") hint.col = meta.loc.column;
      return hint;
    }
    current = current.parentElement;
    depth += 1;
  }
  return null;
}

function fromComponentChain(el: Element): SourceHint | null {
  const chain: string[] = [];

  let fiber = fiberOf(el);
  let depth = 0;
  while (fiber && chain.length < 6 && depth < 40) {
    const name = componentName(fiber);
    if (name && name !== chain[chain.length - 1]) chain.push(name);
    fiber = fiber._debugOwner ?? fiber.return ?? null;
    depth += 1;
  }

  if (chain.length === 0) {
    // Vue exposes the owning component instance on the host element.
    let current: Element | null = el;
    let vueDepth = 0;
    while (current && chain.length < 6 && vueDepth < 20) {
      const instance = (
        current as unknown as {
          __vueParentComponent?: { type?: { name?: string; __name?: string } };
        }
      ).__vueParentComponent;
      const name = instance?.type?.name ?? instance?.type?.__name;
      if (name && name !== chain[chain.length - 1]) chain.push(name);
      current = current.parentElement;
      vueDepth += 1;
    }
  }

  return chain.length > 0 ? { kind: "component", chain, confidence: 0.8 } : null;
}

/* ------------------------------------------------ strategy 4: data attributes */

function fromDataAttributes(el: Element): SourceHint | null {
  const attrs: Record<string, string> = {};
  let current: Element | null = el;
  let depth = 0;
  while (current && Object.keys(attrs).length < 4 && depth < 5) {
    for (const name of DATA_ATTRS) {
      const value = current.getAttribute(name);
      if (value && !(name in attrs)) attrs[name] = value;
    }
    if (current.id && !("id" in attrs)) attrs["id"] = current.id;
    current = current.parentElement;
    depth += 1;
  }
  return Object.keys(attrs).length > 0 ? { kind: "data", attrs, confidence: 0.7 } : null;
}

/* ------------------------------------------------------------ strategy 5: CSS */

function styleSheetFile(sheet: CSSStyleSheet): string {
  const href = sheet.href;
  if (href) {
    try {
      return new URL(href).pathname.split("/").pop() ?? href;
    } catch {
      return href;
    }
  }
  const owner = sheet.ownerNode as Element | null;
  const id = owner?.getAttribute?.("id");
  return id ? `<style#${id}>` : "<style>";
}

function fromCssRules(el: Element): SourceHint | null {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = (sheet as CSSStyleSheet).cssRules;
    } catch {
      continue; // cross-origin stylesheet; nothing to read
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      let matches = false;
      try {
        matches = el.matches(rule.selectorText);
      } catch {
        continue;
      }
      if (!matches) continue;
      // Skip catch-all rules; they say nothing about where this element lives.
      if (rule.selectorText === "*" || rule.selectorText.length < 3) continue;
      return {
        kind: "css",
        file: styleSheetFile(sheet as CSSStyleSheet),
        selectorText: rule.selectorText,
        confidence: 0.6,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------- strategy 6: selector */

/** Exclude form and editable content even when their parent is selected. */
export function reviewText(el: Element): string {
  const privateContent =
    'textarea, select, [contenteditable]:not([contenteditable="false"]), script, style, #browser-review-overlay';
  if (el.closest(privateContent)) return "";
  const clone = el.cloneNode(true) as Element;
  for (const child of clone.querySelectorAll(privateContent)) child.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function fromSelector(el: Element): SourceHint {
  const rect = el.getBoundingClientRect();
  const hint: SourceHint = {
    kind: "selector",
    value: uniqueSelector(el),
    bbox: {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    confidence: 0.4,
  };
  const text = reviewText(el).slice(0, 120);
  if (text) hint.text = text;
  const aria = el.getAttribute("aria-label");
  if (aria) hint.ariaLabel = aria;
  return hint;
}

/**
 * Collect every lead we can find, best first.
 *
 * Each strategy is independent and guarded: a page that breaks one of them —
 * a cross-origin stylesheet, a framework we guessed wrong about — still yields
 * the rest.
 */
export function collectSourceHints(el: Element): SourceHint[] {
  const hints: SourceHint[] = [];
  const strategies = [
    fromReviewSrcAttribute,
    fromSvelteMeta,
    fromReactDebugSource,
    fromComponentChain,
    fromDataAttributes,
    fromCssRules,
  ];
  for (const strategy of strategies) {
    const hint = safe(() => strategy(el));
    if (hint) hints.push(hint);
  }
  const selector = safe(() => fromSelector(el));
  if (selector) hints.push(selector);
  return hints.toSorted((a, b) => b.confidence - a.confidence);
}
