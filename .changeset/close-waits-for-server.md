---
"browser-review": patch
---

`close` now returns once the review server has exited, and a server that is
still shutting down no longer marks a session that was reopened in the meantime
as closed.
