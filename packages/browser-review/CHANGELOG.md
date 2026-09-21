# browser-review

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
