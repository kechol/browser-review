# How an annotation finds its way back to the code

When you click an element, the overlay collects every lead it can and attaches
them all, ordered by confidence. Confidence is a fixed score per strategy, not a
measurement: it says how directly that strategy maps a DOM node onto a source
location. The agent works down the list and stops at the first one that lands.

Each strategy runs inside its own `try`/`catch`. A page that defeats one — a
cross-origin stylesheet, a framework we guessed wrong about — still produces the
rest.

## 0.95 — `data-review-src`

```json
{ "kind": "loc", "file": "src/Button.tsx", "line": 12, "col": 5, "via": "data-review-src" }
```

The overlay reads the attribute from the element or its nearest ancestor that
has one. Two things put it there:

- **`html-file` mode**, on every element, from the parser's own positions.
- **`@browser-review/vite-plugin`**, on every JSX element, in dev.

This is the only strategy that survives minification, framework upgrades, and
React's release notes. If you review the same app often, it is worth setting up.

## 0.90 — framework debug metadata

**Svelte** attaches `__svelte_meta.loc` to elements it created, which is a file
and a line.

**React** used to attach `_debugSource` to fibers, filled in by
`@babel/plugin-transform-react-jsx-source`. The overlay walks the fiber's owner
chain looking for it.

> **React 19 no longer emits `_debugSource`.** On React 19 this strategy simply
> returns nothing, and the annotation falls through to the component chain. This
> is the reason `@browser-review/vite-plugin` exists.

## 0.80 — the component chain

```json
{ "kind": "component", "chain": ["StatCard", "App"] }
```

React's fiber tree gives `type.displayName ?? type.name` up the owner chain;
Vue's `__vueParentComponent` gives the same thing up the DOM. Up to six names,
nearest first.

A name is something to grep for — `rg "function StatCard|const StatCard"` — not
a location. It is usually enough.

**What breaks it.** A production build with mangled names. Components defined
as anonymous arrow functions assigned to nothing. Web components and plain
templating, which have no chain at all.

## 0.70 — data attributes

`data-testid`, `data-test`, `data-test-id`, `data-cy`, `data-qa`,
`data-component`, `data-name`, and `id`, gathered from the element and up to
four ancestors.

If your team already writes test ids, this works surprisingly well: the value is
usually unique in the repository, so one grep finds the element.

## 0.60 — the CSS rule

```json
{ "kind": "css", "file": "app.css", "selectorText": ".stat-card" }
```

The overlay walks `document.styleSheets` and returns the first rule the element
matches. Cross-origin stylesheets throw on access and are skipped; universal and
one-character selectors are ignored as saying nothing.

## 0.40 — a generated selector

```json
{
  "kind": "selector",
  "value": "section.features > article:nth-of-type(2) > h2",
  "text": "Sort",
  "ariaLabel": null,
  "bbox": { "x": 32, "y": 420, "width": 220, "height": 24 }
}
```

The fallback, and the one hint that is always present. The selector is built
from an `id` if it is unique, then a test attribute, then a _distinctive_ class
name, then `:nth-of-type`.

"Distinctive" excludes utility classes — `mt-4`, `text-sm`, `flex`,
`hover:bg-blue-500` and the rest of that family. A selector made of utility
classes matches half the page, which is worse than no selector at all. On a
Tailwind-styled app you should expect this hint to be structural
(`div > div:nth-of-type(3) > button`) and to lean on `text` instead.

The `bbox` records where the element was when the annotation was created. It is
not treated as proof that the same element still occupies that position. After
DOM changes, the overlay confirms an unambiguous candidate from the saved tag
and available selector, text, ARIA, data, and source-location hints. If those
hints conflict, match multiple elements, or point at another pathname, the
comment stays readable in the list and card as an unconfirmed location, but the
overlay does not place a normal pin or scroll to a guessed element. Two truly
identical repeated elements cannot always be distinguished without a stable id
or source hint.

## What never travels

Whatever the strategies find, the annotation carries:

- at most 500 characters of the element's own markup, with `value` attributes
  replaced
- the page URL, path and title
- the comment you typed

It does not carry form field values, `document.cookie`, `localStorage`,
`sessionStorage`, IndexedDB, or the markup of anything you did not click.
