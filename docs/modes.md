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

**Localhost by default.** HTTP and HTTPS on `localhost`, `127.0.0.1`, and `::1`
work without a remote opt-in. HTTPS still uses normal certificate and hostname
verification; pass `--ca-file ./ca.pem` to use a PEM trust bundle for only that
session. A trusted,
self-managed staging origin can be selected explicitly:

```sh
browser-review open https://staging.example.test/admin --allow-remote
```

An exact origin can instead be registered for later startups:

```sh
browser-review trust add https://staging.example.test
browser-review trust list
browser-review trust remove https://staging.example.test
```

The registry is `trusted-origins.json` under the state root. It contains only a
sorted array of canonical origins—not credentials or CA material. A registered
origin still goes through unsafe-address rejection, one-time DNS resolution and
pinning, and TLS verification. Removal affects later starts, not a running
session.

Remote mode accepts one HTTPS origin, rejects URL userinfo and special-use DNS
answers, and pins the validated startup answer set. `Host`, TLS SNI and normal
certificate verification use the original hostname for HTTPS and WSS. There is
no HTTP-remote or insecure-TLS option. The review server itself still binds only
to `127.0.0.1`.

**`Content-Security-Policy` is removed.** A dev server's policy is written for
its own origin and would block the overlay. The header is dropped from proxied
responses and a line is written to the server log the first time it happens.
The trade is deliberate, but it is a real difference from how your app normally
runs — if you are testing CSP behaviour, test it without the proxy. For a remote
target, this is also why the origin and every script it serves must be trusted.

**Responses are buffered, not streamed, when they are HTML.** The body has to be
readable to have the overlay put into it. `Accept-Encoding: identity` is sent
upstream for the same reason. Over loopback this costs nothing measurable;
streamed HTML (server-sent rendering that trickles out) will arrive all at once.

**Redirects are rewritten.** A `Location` pointing at the upstream comes back
pointing at the review server, matched by port rather than by hostname — dev
servers told to listen on `localhost` routinely answer with `127.0.0.1`.
Remote redirects are stricter: only root-relative redirects and absolute or
protocol-relative redirects to the exact selected origin are rewritten.
Cross-origin and HTTPS-to-HTTP redirects leave the proxy and receive none of the
session-only staging credentials.

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

### Root-relative resources

Opening the tokenized review URL sets a session cookie (`HttpOnly`,
`SameSite=Strict`) for application requests such as `/assets/app.js`, module
imports, and HMR sockets. It contains a separate random application token,
never the control token; it is stripped before forwarding to the upstream.
Requests without that cookie still need the URL token. Control endpoints
remain exclusively under `/r/<token>/__br/`; the cookie cannot authorize them.
Cookie names include the review port to keep concurrent sessions separate.

### Remote credentials and cookies

Remote mode never forwards the browser's cookies, `Authorization`, `Referer`, or
forwarding headers. It rewrites only a valid review-server `Origin` to the
selected upstream origin. Upstream cookies stay in a memory-only jar for that
session and are applied using Domain, Path, Secure, expiry, and deletion rules;
they are not stored by the browser against loopback. The same rules cover HTTP
and WebSocket handshakes. Upstream authentication challenges, site-data clears,
and reporting configuration are also removed from browser responses.

For Basic or Bearer staging authentication, set one value in the environment
before starting the session, for example through your shell's secret-management
workflow:

```sh
export BROWSER_REVIEW_REMOTE_AUTHORIZATION='Bearer replace-with-staging-token'
browser-review open https://staging.example.test/admin --allow-remote
unset BROWSER_REVIEW_REMOTE_AUTHORIZATION
```

The credential is inherited by the detached review process but is not placed in
its command line, session file, logs, MCP output, or errors. Prefer a read-only
staging account. The proxy does not promise that browsing is read-only: login
and application mutations are both ordinary HTTP requests.

Alternatively, `--cookie-file <path>` imports one Netscape-format cookie jar.
It works with local or remote HTTPS, including `#HttpOnly_` records, and is
limited to 1 MiB and 1,000 records. The file is read once and remains owned by
the user; browser-review does not copy, rewrite, chmod, or delete it. Expired or
out-of-scope cookies are ignored. Imported cookies and later `Set-Cookie`
updates are restricted to the session's exact scheme, host, and port and use
normal Domain, Path, Secure, expiry, and deletion rules for HTTP and WebSocket.
Browser cookies are not mixed into a cookie-file session.

Cookie contents and CA contents are not written to argv, logs, session JSON,
MCP output, or errors. Their file paths are passed to the child process so it
can read them once. There is no raw Cookie-header, JSON-cookie, ambient browser
cookie, or insecure-TLS mode.

Remote mode is not a content sandbox. The target page and its scripts can see
the tokenized path and reach the review control API. Absolute URLs in HTML or
JavaScript are not rewritten and may be fetched directly by the browser. Use it
only with a staging origin that you own, administer, and trust.

Applications that inspect their initial pathname still see the review prefix.
Configure the router base accordingly; the proxy does not rewrite application
JavaScript or emulate the original origin.
