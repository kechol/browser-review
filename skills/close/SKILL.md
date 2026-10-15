---
name: close
description: Stop running browser review sessions and shut down their local servers. Use when the user is finished reviewing, or says to close or stop the review.
allowed-tools: Bash(npx browser-review:*), Bash(browser-review:*)
---

# Close review sessions

Pick the command from what the user asked to close:

```sh
# A specific page or URL (several may be listed):
npx -y browser-review@^0.4.0 close <file-or-url>
# Every session of this project:
npx -y browser-review@^0.4.0 close --project
# Nothing specific:
npx -y browser-review@^0.4.0 close
```

Run them from the project directory. Without arguments, `close` closes the
project's session when exactly one is running. When several are running it
closes nothing, lists them and exits with status 1: show the list and ask the
user which to close, or whether to close all of them. `--session <sessionId>`
closes one by id. Use `/browser-review:status` if you need to see which
sessions exist.

Closing stops the server and marks the session file closed. The output says how
many comments were left unresolved; mention them. Opening the same target again
reopens the session with those comments. The annotations stay under
`~/.browser-review/sessions/` by default, or
`$XDG_STATE_HOME/browser-review/sessions/` when that variable is non-empty. A
housekeeping sweep removes them a week after the session closed.

Afterwards:

- If this session has unreviewed edits from the review loop, remind the user to
  look at the diff before committing.
- Mention `claude mcp remove review` only if the user connected a _second_
  session to the handoff URL by hand. The session that has the plugin installed
  needs nothing removed.
