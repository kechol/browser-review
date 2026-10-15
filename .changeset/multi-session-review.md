---
"browser-review": minor
---

Review several pages at once. `open` accepts several targets and gives each its
own session; the plugin's MCP server now watches every running session of the
project, so `review_wait` delivers comments from all of them, grouped with each
session's own editing scope, and picks up pages opened mid-review. Opening a
target that is already running returns its session, and opening one whose
session was closed reopens it with its comments. `close` acts on the current
project: name the targets, pass `--project`, or run it bare to close the only
running session. Closed sessions are swept a week after they closed.
