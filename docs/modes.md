# The two modes

browser-review works one of two ways depending on what you point it at. The
difference is not cosmetic: it decides how the overlay gets into the page, how
precisely the agent can locate code, and what the agent is allowed to edit.

## `html-file`

```sh
browser-review open ./landing.html
```

The server parses the file with `parse5`, tags every element with the line and
column it was written on, appends the overlay, and serves it. Files sitting next
to it — stylesheets, images, other pages — are served from the same directory.

**The file on disk is never modified.** The attributes are spliced into the
response text at the offsets the parser reports, so the file the agent opens
still matches, line for line, what the browser showed.

- **Source hints**: exact. Every annotation carries a `loc` hint at confidence
  0.95.
- **Editing scope**: that one file. `review_resolve` warns if the agent reports
  changing anything else.
- **Reload**: the server watches the directory and pushes a reload when
  anything changes, so a fix appears without a manual refresh.

**Limits.** Only `.html` and `.htm` are accepted. Anything the page loads from
outside its own directory has to be reachable by URL; there is no bundler.
Traversal out of that directory is refused.

## `proxy`

```sh
browser-review open http://localhost:5173/admin
```

Every request is forwarded to your dev server. Responses that are not HTML pass
through untouched. HTML gets the overlay spliced in before `</body>`. WebSocket
upgrades are tunnelled byte for byte, so hot module reload keeps working.

- **Source hints**: whatever the framework leaves in the DOM. See
  [source-hints.md](source-hints.md).
- **Editing scope**: files under the project directory — `--project-dir`, or
  `$CLAUDE_PROJECT_DIR`, or the working directory.
- **Reload**: your dev server's, passed through.

### Things worth knowing

**Only localhost.** `http://localhost`, `http://127.0.0.1` and `http://[::1]`
are accepted; anything else is refused with an explanation. Injecting a review
overlay into a site you do not run would mean proxying someone else's origin.

**`Content-Security-Policy` is removed.** A dev server's policy is written for
its own origin and would block the overlay. The header is dropped from proxied
responses and a line is written to the server log the first time it happens.
This is a loopback-only review tool and the trade is deliberate, but it is a
real difference from how your app normally runs — if you are testing CSP
behaviour, test it without the proxy.

**Responses are buffered, not streamed, when they are HTML.** The body has to be
readable to have the overlay put into it. `Accept-Encoding: identity` is sent
upstream for the same reason. Over loopback this costs nothing measurable;
streamed HTML (server-sent rendering that trickles out) will arrive all at once.

**Redirects are rewritten.** A `Location` pointing at the upstream comes back
pointing at the review server, matched by port rather than by hostname — dev
servers told to listen on `localhost` routinely answer with `127.0.0.1`.

**Control routes live under `__br/`.** The session's own endpoints are at
`/r/<token>/__br/…` rather than `/r/<token>/…`, so an application route named
`/feed` or `/resolve` is not shadowed by ours.

**Entry path.** If you open `http://localhost:5173/admin`, the review URL lands
on `/admin` rather than the root.

## Choosing

Reviewing a single static page, a design mock, an email template, a generated
report? `html-file`. You get exact line numbers for free and nothing has to be
running.

Reviewing an application? `proxy`. Add
[`@browser-review/vite-plugin`](../packages/vite-plugin) if you are on Vite —
it buys back the exact line numbers that `html-file` mode gets by parsing.
