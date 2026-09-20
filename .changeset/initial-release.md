---
"browser-review": minor
"@browser-review/vite-plugin": minor
---

First release.

`browser-review open` starts a loopback review server for either a local HTML
file or a `http://localhost` dev server, and injects an overlay that lets a
person click an element and say what should change about it. The comment
reaches an agent over MCP — on stdio for the session that owns the plugin, or
over Streamable HTTP for a second session — carrying source hints ordered by how
directly each one maps the element back to code. The agent fixes it and the pin
turns green in the browser.

`@browser-review/vite-plugin` tags JSX elements with `data-review-src` in dev,
which restores the exact file and line that React 19 no longer provides.
