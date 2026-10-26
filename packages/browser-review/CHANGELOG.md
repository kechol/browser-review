# browser-review

## 0.4.1

### Patch Changes

- [#24](https://github.com/kechol/browser-review/pull/24) [`d100d06`](https://github.com/kechol/browser-review/commit/d100d06a27c0cff18c55ff9cda93bb42009b949a) Thanks [@kechol](https://github.com/kechol)! - Require Node.js 24.22.1 or newer on the 24 line, or 26.12.1 or newer. Older
  releases still accept certificates from the compromised eMudhra (emSign)
  intermediate CAs, so an HTTPS proxy target could be impersonated.

## 0.4.0

### Minor Changes

- [#21](https://github.com/kechol/browser-review/pull/21) [`2a73ed2`](https://github.com/kechol/browser-review/commit/2a73ed223ed0934504a3cdb02b8a5bcc275376f6) Thanks [@kechol](https://github.com/kechol)! - Review several pages at once. `open` accepts several targets and gives each its
  own session; the plugin's MCP server now watches every running session of the
  project, so `review_wait` delivers comments from all of them, grouped with each
  session's own editing scope, and picks up pages opened mid-review. Opening a
  target that is already running returns its session, and opening one whose
  session was closed reopens it with its comments. `close` acts on the current
  project: name the targets, pass `--project`, or run it bare to close the only
  running session. Closed sessions are swept a week after they closed.

- [#11](https://github.com/kechol/browser-review/pull/11) [`44fa7fc`](https://github.com/kechol/browser-review/commit/44fa7fca0b6e72fa154780d2a546e765c7a1607f) Thanks [@kechol](https://github.com/kechol)! - Track annotation positions conservatively across DOM changes and reconnects,
  move the default state directory to `~/.browser-review`, add experimental
  Windows CLI support, and support exact trusted origins, localhost HTTPS,
  session-only custom CAs, and Netscape cookie files.
  Open status details from the connection indicator or the `s` shortcut instead
  of a separate toolbar menu item.

### Patch Changes

- [#22](https://github.com/kechol/browser-review/pull/22) [`a55ea03`](https://github.com/kechol/browser-review/commit/a55ea03517437b52c92da875d65b008b7aee9642) Thanks [@kechol](https://github.com/kechol)! - `close` now returns once the review server has exited, and a server that is
  still shutting down no longer marks a session that was reopened in the meantime
  as closed.

## 0.3.1

### Patch Changes

- [#9](https://github.com/kechol/browser-review/pull/9) [`ccad11d`](https://github.com/kechol/browser-review/commit/ccad11d2351404433d939d1b694d32654fbacd5b) Thanks [@kechol](https://github.com/kechol)! - Fix CLI startup through npm, npx and Homebrew symlinks. Verify packaged CLI entrypoints and allow more time for npm archive availability before updating Homebrew.

## 0.3.0

### Minor Changes

- [#8](https://github.com/kechol/browser-review/pull/8) [`00faa9a`](https://github.com/kechol/browser-review/commit/00faa9a6e143bd53ac71dac6fa257b807b70c278) Thanks [@kechol](https://github.com/kechol)! - Add explicit, HTTPS-only proxy review for trusted staging origins with DNS pinning, normal TLS verification, and session-isolated credentials while preserving localhost defaults.

### Patch Changes

- [`f4c3026`](https://github.com/kechol/browser-review/commit/f4c302684f93e762dc36ff2ea846c6e662068d79) Thanks [@kechol](https://github.com/kechol)! - Fix Claude Code open, status and close skills to use the current CLI release range, and keep those ranges synchronized during version updates.

## 0.2.1

### Patch Changes

- Publish stable CLI releases from version tags and update Homebrew only after npm publication succeeds.

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

- [`91de65b`](https://github.com/kechol/browser-review/commit/91de65b3d023c0d3657b66c73d5eb68239a14fca) Thanks [@kechol](https://github.com/kechol)! - Document npm and Homebrew installation and add release tooling to generate a Homebrew formula from the published npm archive.

- [`014f3dd`](https://github.com/kechol/browser-review/commit/014f3ddf60bfd84a97623209ee48120f0de627c5) Thanks [@kechol](https://github.com/kechol)! - Limit automatic prompt-hook and stdio MCP session selection to the current project, preserving explicit session handoffs. Include package READMEs and current license notices in both published packages, and correct the Vite plugin runtime dependency notice.
