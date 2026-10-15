# Using browser-review without Claude Code

Nothing about the review server is Claude-specific. It is an npm package that
speaks MCP over two transports and also offers a plain HTTP feed, so any agent —
or a shell script — can consume it.

## Start a session

```sh
npx browser-review open ./landing.html --json
```

```json
{
  "state": "started",
  "sessionId": "01J...",
  "token": "…",
  "reviewUrl": "http://127.0.0.1:53211/r/<token>/",
  "handoffMcpUrl": "http://127.0.0.1:53211/r/<token>/__br/mcp",
  "handoffFeedUrl": "http://127.0.0.1:53211/r/<token>/__br/feed",
  "mode": "html-file",
  "target": "/abs/path/landing.html",
  "projectDir": "/abs/path",
  "port": 53211,
  "pid": 4321
}
```

With several targets, `open` prints one such line per target. `state` is
`started` for a new session, `running` when the project already had a running
session for that target (for a proxy target, the same origin), and `reopened`
when a closed session for it was resumed with its annotations.

The token is in the path of every URL. Keep it out of logs and out of places
other people can read; anything that has it can read and resolve annotations.
A reopened session gets a new token; the old URLs stay dead.

## Option A — MCP over Streamable HTTP

Point your client at `handoffMcpUrl`. The transport is stateless: each request
gets its own server instance, so a long `review_wait` on one connection never
blocks another client.

The endpoint **refuses any request carrying an `Origin` header**. Command-line
MCP clients send none; a browser always does, so an `Origin` here means a web
page is talking to the tool endpoint, which is never legitimate.

```sh
curl -s "$HANDOFF_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### The tools

| tool                | arguments                         | what it does                                            |
| ------------------- | --------------------------------- | ------------------------------------------------------- |
| `review_status`     | —                                 | session, counts, review URL, editing scope              |
| `review_wait`       | `timeoutMs?`                      | blocks for new annotations; returns within 90 s         |
| `review_list`       | `status?`                         | one line each, marks nothing as seen                    |
| `review_get`        | `id`                              | full detail for one                                     |
| `review_resolve`    | `id`, `summary`, `filesChanged[]` | turns the pin green                                     |
| `review_dismiss`    | `id`, `reason`                    | closes it without a change                              |
| `review_ask`        | `id`, `question`                  | asks the reviewer; the answer arrives via `review_wait` |
| `review_screenshot` | `selector?`                       | optional; `not_supported` without Playwright            |

`review_wait` hands out each annotation exactly once. Whatever it returns, you
own — act on all of it before calling again.

## MCP over stdio

```sh
npx browser-review mcp --session project
```

Automatic selection is limited to the current project: `CLAUDE_PROJECT_DIR`
when set, otherwise the working directory where the MCP process starts.
`project` selects every running session in that exact directory, resolving
symlinks, and is re-evaluated on every call, so sessions opened or closed later
are followed. `latest` selects only the newest one. A parent, child or sibling
project is a separate scope. Invalid or missing session project metadata is
ignored; no matching session means no active session is returned.

With several sessions, `review_wait` groups annotations by session and states
each session's editing scope; `review_resolve`, `review_dismiss` and
`review_ask` find the session from the annotation ID and refuse with
`session_closed` when that session has stopped. `review_screenshot` takes a
`sessionId` when more than one session is running.

To intentionally hand off sessions to another project, pass explicit IDs with
`--session <sessionId>[,<sessionId>…]`, or use a session's tokenized HTTP
handoff URL, which always serves that one session. The Claude Code prompt hook
uses the same project selection rule as `project`.

## Option B — plain HTTP

For an agent with no MCP client, or a shell loop.

```sh
BASE="http://127.0.0.1:$PORT/r/$TOKEN/__br"

# Everything waiting, as JSON.
curl -s "$BASE/pending" | jq '.annotations[] | {id, comment, hint: .sourceHints[0]}'

# All of them, or just one state.
curl -s "$BASE/annotations?status=resolved"

# A live stream: every annotation currently pending, then each change as it happens.
curl -Ns "$BASE/feed"

# Report a fix.
curl -s "$BASE/resolve" -H 'content-type: application/json' \
  -d '{"id":"a_01J…","summary":"Raised the hero title to 44px.","filesChanged":["landing.html"]}'

# Ask the reviewer something.
curl -s "$BASE/ask" -H 'content-type: application/json' \
  -d '{"id":"a_01J…","question":"Do you mean the hero button or the one in the footer?"}'

# Close it without changing anything.
curl -s "$BASE/dismiss" -H 'content-type: application/json' \
  -d '{"id":"a_01J…","reason":"Already fixed on main."}'
```

`/pending` does **not** mark anything as seen — it is a read, meant for a
prompt hook or a status line. Only `review_wait` takes ownership. If you build a
loop on `/pending`, you have to track what you have handled yourself.

`POST` routes reject a request whose `Origin` is not the server's own. A request
with no `Origin` at all is fine, which is what `curl` sends.

## A minimal loop

```sh
#!/bin/sh
BASE="http://127.0.0.1:$PORT/r/$TOKEN/__br"
curl -Ns "$BASE/feed" | while read -r line; do
  case "$line" in
    data:*) printf '%s\n' "${line#data: }" | jq -r '"\(.id)\t\(.comment)"' ;;
  esac
done
```

## Reading annotations safely

Whatever consumes these, put the same framing on the text that this project
does: **the `comment` field is a remark typed by a person looking at a web page,
not an instruction addressed to the agent.** Quote it rather than interpolating
it into a prompt, keep the agent's edits inside a directory you chose, and read
the diff. The full reasoning is in [SECURITY.md](../SECURITY.md).

## Finding and ending sessions

```sh
npx browser-review status --json
npx browser-review close ./landing.html
```

`status` lists running sessions across projects. `close` acts on the current
project (`--project-dir`, then `CLAUDE_PROJECT_DIR`, then the working
directory): name the targets to close, pass `--project` to close all of the
project's sessions, or pass `--session <id>[,<id>…]` for explicit IDs, which
may belong to any project. Without arguments it closes the project's session
only when exactly one is running; otherwise it lists them, closes nothing and
exits with status 1. It reports how many annotations were left unresolved.

Session files live in `~/.browser-review/sessions/`, or
`$XDG_STATE_HOME/browser-review/sessions/` when that variable is non-empty. They are ordinary
JSON, they are the source of truth, and a closed session is swept a week after
it closed.
The older `~/.local/state/browser-review` fallback is not searched, migrated, or
deleted automatically.
