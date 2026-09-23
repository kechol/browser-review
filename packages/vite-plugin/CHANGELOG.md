# @browser-review/vite-plugin

## 0.2.1

### Patch Changes

- [#11](https://github.com/kechol/browser-review/pull/11) [`44fa7fc`](https://github.com/kechol/browser-review/commit/44fa7fca0b6e72fa154780d2a546e765c7a1607f) Thanks [@kechol](https://github.com/kechol)! - Track annotation positions conservatively across DOM changes and reconnects,
  move the default state directory to `~/.browser-review`, add experimental
  Windows CLI support, and support exact trusted origins, localhost HTTPS,
  session-only custom CAs, and Netscape cookie files.
  Open status details from the connection indicator or the `s` shortcut instead
  of a separate toolbar menu item.

## 0.2.0

### Minor Changes

- [`8ae7b40`](https://github.com/kechol/browser-review/commit/8ae7b40b371f870dd31f0c3ef385841fc0d6cf8c) Thanks [@kechol](https://github.com/kechol)! - First release.
  
  `browser-review open` starts a loopback review server for either a local HTML
  file or a `http://localhost` dev server, and injects an overlay that lets a
  person click an element and say what should change about it. The comment
  reaches an agent over MCP — on stdio for the session that owns the plugin, or
  over Streamable HTTP for a second session — carrying source hints ordered by how
  directly each one maps the element back to code. The agent fixes it and the pin
  turns green in the browser.
  
  `@browser-review/vite-plugin` tags JSX elements with `data-review-src` in dev,
  which restores the exact file and line that React 19 no longer provides.

- [`2c149f9`](https://github.com/kechol/browser-review/commit/2c149f9852529378621035085cdd0bf48767103d) Thanks [@kechol](https://github.com/kechol)! - Require Node.js 24 or newer and update the build toolchain to pnpm and TypeScript 7.

### Patch Changes

- [`014f3dd`](https://github.com/kechol/browser-review/commit/014f3ddf60bfd84a97623209ee48120f0de627c5) Thanks [@kechol](https://github.com/kechol)! - Limit automatic prompt-hook and stdio MCP session selection to the current project, preserving explicit session handoffs. Include package READMEs and current license notices in both published packages, and correct the Vite plugin runtime dependency notice.
