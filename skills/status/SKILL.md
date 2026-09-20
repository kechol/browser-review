---
name: status
description: Show running browser review sessions — what is being reviewed, the URL to open, the handoff URL for another agent, and how many comments are waiting.
allowed-tools: Bash(npx browser-review:*), Bash(browser-review:*)
---

# Review session status

Run:

```sh
npx -y browser-review@^0.1.0 status --json
```

It prints `{"sessions": [...]}`, one entry per running session, each with
`sessionId`, `mode`, `target`, `projectDir`, `reviewUrl`, `handoffMcpUrl`,
`handoffFeedUrl` and a `counts` object.

Present it as a short list, not raw JSON. For each session give the target being
reviewed, the review URL, and the counts that are not zero. If a session has
pending comments, say so and offer `/browser-review:resolve`.

If `sessions` is empty, say that nothing is running and that
`/browser-review:open <file-or-url>` starts a session. Do not start one on your
own.
