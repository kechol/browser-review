---
name: close
description: Stop a running browser review session and shut down its local server. Use when the user is finished reviewing, or says to close or stop the review.
allowed-tools: Bash(npx browser-review:*), Bash(browser-review:*)
---

# Close a review session

Run:

```sh
npx -y browser-review@^0.2.0 close --session latest
```

To close a specific one instead, pass its id: `--session <sessionId>`. Use
`/browser-review:status` if you need to see which sessions exist.

Closing stops the server and marks the session file closed. The annotations
stay on disk under `$XDG_STATE_HOME/browser-review/sessions/`, where a
housekeeping sweep removes them once they are a week old.

Afterwards:

- If this session has unreviewed edits from the review loop, remind the user to
  look at the diff before committing.
- Mention `claude mcp remove review` only if the user connected a _second_
  session to the handoff URL by hand. The session that has the plugin installed
  needs nothing removed.
