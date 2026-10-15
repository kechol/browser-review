# How the pieces fit together

```
          browser
   ┌──────────────────────┐
   │  your page           │
   │  + overlay (shadow   │
   │    DOM, no deps)     │
   └──────────┬───────────┘
              │ WebSocket, same origin only
              ▼
   ┌──────────────────────────────────────────────┐
   │  review server — one process, 127.0.0.1 only │
   │                                              │
   │  serve a file  │  or proxy a dev server      │
   │  ──────────────┴───────────────────────────  │
   │  MCP over Streamable HTTP   /__br/mcp        │
   │  HTTP feed                  /__br/feed …     │
   └──────────┬───────────────────────────────────┘
              │ session file (JSON, atomic rename + lock)
              ▼
   ~/.browser-review/sessions/<id>.json
   (or $XDG_STATE_HOME/browser-review/sessions/<id>.json)
              ▲
              │ same file
   ┌──────────┴───────────┐        ┌──────────────────────┐
   │  MCP over stdio      │        │  UserPromptSubmit    │
   │  (the plugin's own   │        │  hook — reads the    │
   │   session)           │        │  file directly       │
   └──────────────────────┘        └──────────────────────┘
```

## Why the session file is the hub

Three processes need the same state: the server that owns the WebSocket, the
stdio MCP server that Claude Code starts from the plugin, and the prompt hook
that runs for a few milliseconds on every message. They cannot share memory, and
a second socket between them would be one more thing to fail at startup.

A JSON file works for all three. Writes go through a lock file and land with an
atomic rename, so a reader sees either the old file or the new one. The server
polls it twice a second, and watches its directory, so a change made by the
stdio process — an agent resolving an annotation — reaches the browser without
either process knowing the other exists.

The directory is a deliberate choice too: `~/.browser-review` by default, or a
non-empty `$XDG_STATE_HOME/browser-review`, never the repository. Review
comments and session tokens should not be one `git add .` away from a public
commit. The former `~/.local/state/browser-review` fallback is not searched or
migrated automatically.

## Why each target gets its own server

Reviewing several pages at once means several sessions, one per target, each
with its own server process and port. One server carrying several targets would
have to decide which upstream a root-relative request such as `/assets/app.js`
belongs to, and the only thing it carries is an application cookie that is
scoped to the port. A process per target keeps that cookie, the pinned
upstream address and any imported cookies or CA bound to exactly one target.

The agent side does the gathering instead. The plugin's stdio MCP server runs
with `--session project` and, on every call, selects every running session of
the current project; `review_wait` keeps re-selecting while it waits, so a
target opened mid-review joins the loop. The prompt hook reads the same set.
Each annotation still carries its own session's editing scope: an agent fixing
a comment from one page gains no permission to edit the file served by
another.

Opening a target that already has a running session in the project returns
that session; for a proxy target the origin is what counts, so two paths into
one application share a session. Opening a target whose session was closed
reopens it with a new token and port and its earlier annotations.

## Why `review_wait` returns within 90 seconds

Claude Code moves an MCP call made from the main conversation into a background
task once it has been running for two minutes. A review loop that gets detached
from the conversation that started it is worse than useless — the user is
talking to a session that is no longer listening. Ninety seconds keeps every
wait inside that window with room to spare, at the cost of the agent calling
`review_wait` again. `REVIEW_WAIT_MAX_MS` in `packages/shared` is the constant.

## Why annotations are handed out exactly once

`review_wait` reads and marks in a single locked read-modify-write. Two agents
connected to the same session cannot both receive the same annotation, and an
agent that receives one owns it. The same mechanism brings an annotation back
when the reviewer answers a question: the answer is recorded as undelivered, and
the next `review_wait` picks it up and marks it delivered.

`/pending` deliberately does not do this. It is a read, for the prompt hook and
for status displays.

## Why the overlay is dependency-free

It runs inside someone else's page. Anything it pulls in is something that can
collide with, or be broken by, the application being reviewed. It is a single
minified IIFE that puts everything inside a shadow root, and the only global
state it touches is one `<div>` with a known id.

Its configuration arrives on `data-` attributes of its own `<script>` tag rather
than an inline script, so a page served with `script-src 'self'` needs no
exception.

## Why the transport is split from the tools

`packages/browser-review/src/mcp.ts` defines the tools against a `ToolContext`
and knows nothing about how it was reached. The same definitions are handed to a
stdio transport in one process and a Streamable HTTP transport in another. A
`Delivery` interface sits under `review_wait` for the same reason: today it
polls the session file, and a push transport can replace it without the tools or
the overlay noticing.

## Package layout

| package                       | published | what it is                                                  |
| ----------------------------- | --------- | ----------------------------------------------------------- |
| `browser-review`              | yes       | the CLI, the server, the MCP tools; ships the built overlay |
| `@browser-review/vite-plugin` | yes       | tags JSX with `data-review-src` in dev                      |
| `@browser-review/overlay`     | no        | the injected UI; built into the package above               |
| `@browser-review/shared`      | no        | types and constants; bundled at build time                  |

The plugin repository stays thin: it holds manifests, skills, a hook, and no
built JavaScript. `.mcp.json` starts the published package through `npx`, which
is why the plugin's version and the package's version have to move together —
`pnpm run check:versions` fails the build when they drift.
