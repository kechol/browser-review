# Security Policy

## Supported versions

Only the latest published `0.x` release receives security fixes. `0.x` releases
may contain breaking changes between minor versions.

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a
vulnerability** button on the repository's Security tab, rather than opening a
public issue. We aim to acknowledge reports within 7 days.

Do not include credentials, customer data, or a working exploit chain in the
report. A description of the class of problem and the affected code path is
enough for us to reproduce it.

## Threat model

The browser-review control plane runs on one machine. The review server binds to
`127.0.0.1` only and there is no `--host` option. Local files and localhost HTTP
upstreams remain the default. An explicit `--allow-remote` invocation may make
outbound HTTPS/WSS connections only to its validated, pinned proxy upstream.

### 1. Another local process reaching the review server

Any process running as the same user can reach `127.0.0.1:<port>`.

**Mitigations.** Control routes live under `/r/<token>/__br/`, where the token is 24
random bytes (`crypto.randomBytes(24).toString("base64url")`). A request whose
token does not match is answered with `404`, not `403`, so the server does not
confirm that a session exists. Tokens are never written to logs, and the session
file lives under `$XDG_STATE_HOME/browser-review/` with `0600` permissions.

**Residual risk.** A local process that can read the user's home directory can
read the session file and therefore the token. We consider a local attacker with
filesystem read access to already be past the boundary this tool defends.

Proxy application resources may also use root-relative paths after opening the
tokenized URL. These require a separate random application cookie (`HttpOnly`,
`SameSite=Strict`), stripped before forwarding upstream. This cookie never
authorizes control routes or another session URL. Foreign Origins are rejected.

### 2. DNS rebinding / a malicious page in the same browser

A page on an attacker-controlled origin could try to reach the loopback server
from the victim's browser.

**Mitigations.** WebSocket upgrades and all state-changing `POST` routes check
the `Origin` header and reject anything that is not the server's own origin. The
MCP endpoint at `/r/<token>/__br/mcp` rejects any request that carries an `Origin`
header at all, because legitimate clients are command-line MCP clients. The
attacker would additionally need the token, which is not guessable and is not
exposed cross-origin.

### 3. Prompt injection through annotation text

An annotation's `comment` is free text typed by a human into a web page. It
reaches an agent's context, so it is an untrusted input.

**Mitigations.** Every surface that carries annotation text into a model — MCP
tool descriptions, the MCP server `instructions`, the `UserPromptSubmit` hook
output, and the skill instructions — states that the comment is a user's remark
about the UI and not an instruction to the agent. The skills additionally
constrain edits: in `html-file` mode only the single served file may be edited,
and in `proxy` mode only paths under the project directory. `review_resolve`
warns when a reported changed file falls outside that boundary.

**Residual risk.** Prompt injection is not solved by framing alone. Treat a
review session the way you would treat any other untrusted input to an agent,
and review the diff before committing.

### 4. Leaking page content into the agent's context

**Mitigations.** The overlay sends only the first 500 characters of the selected
element's `outerHTML`, with `value` attributes stripped. It never reads form
field values, `document.cookie`, `localStorage`, `sessionStorage`, or IndexedDB.
Screenshots are opt-in and off by default.

The prompt hook and automatic stdio MCP selection (`mcp --session latest`)
only select active sessions whose canonical project directory exactly matches
`CLAUDE_PROJECT_DIR`, or the process working directory when that variable is
absent. Missing or invalid project metadata is not eligible. An explicit
session ID or tokenized HTTP handoff deliberately selects that session across
projects; share those identifiers only with the intended recipient.

**Residual risk.** This is not an anonymization tool. Comments, page URLs,
visible text, element markup and source hints may contain sensitive information.
Opt-in screenshots can contain anything visible on the page. Review synthetic
or sanitized pages when this content must not reach an agent or its provider.

### 5. A remote proxy target reaching an unintended service

A staging hostname can be mistyped, resolve to a special-use address, or change
its DNS answers after startup. An attacker could otherwise use remote mode as an
SSRF primitive or rebind a validated hostname to a local service.

**Mitigations.** Remote proxying is denied unless that invocation includes
`--allow-remote`. Non-loopback targets must use HTTPS, URL userinfo is rejected,
and DNS is resolved once before the review server listens. The complete answer
set is rejected if any address is loopback (including IPv4-mapped IPv6),
unspecified, link-local, or multicast. Validated addresses are pinned for the
session; later requests do not expand the set. `Host`, TLS SNI, and certificate
verification continue to use the original upstream hostname. TLS verification
cannot be disabled. HTTP and WebSocket requests use the same policy.

The source check permits HTTPS, DNS, and socket primitives only in the dedicated
upstream/proxy implementation and still rejects fixed non-loopback URL targets.

**Residual risk.** RFC1918 and IPv6 ULA addresses are intentionally allowed for
private staging. The user is responsible for choosing the intended service and
for trusting every pinned address returned by its DNS at startup.

### 6. Remote credentials and browser state crossing trust boundaries

The review page is served from a loopback origin, not the staging origin. Passing
ambient browser credentials through would mix those trust domains, while passing
staging `Set-Cookie` headers back would store staging state against loopback.

**Mitigations.** Remote requests discard browser `Cookie`, `Authorization`,
`Referer`, `Forwarded`, `X-Forwarded-*`, `Via`, and `X-Real-IP` headers. A valid
review-server `Origin` is rewritten to the single upstream origin; arbitrary
origins are not synthesized. Remote responses keep cookies in a per-session,
in-memory jar and do not expose `Set-Cookie`, `WWW-Authenticate`,
`Clear-Site-Data`, `NEL`, `Report-To`, or `Reporting-Endpoints` to the browser.
Cookie Domain, Path, Secure, expiry, and deletion rules are applied for HTTP and
WebSocket handshakes. An optional Basic or Bearer value comes only from
`BROWSER_REVIEW_REMOTE_AUTHORIZATION`; it is not placed in CLI arguments, logs,
session JSON, MCP output, or errors. The jar and credential die with the session.

**Residual risk.** The proxy cannot distinguish a login POST from a business-data
mutation. Use a read-only staging account and synthetic fixtures for tests. CSP
is removed to inject the overlay, absolute URLs are not rewritten, and the
trusted page and all of its scripts can observe the tokenized path and access the
review control channel. Remote mode is not a sandbox for third-party content.

## Out of scope

- Exposing the server beyond `127.0.0.1`. There is no supported way to do this.
- Plain-HTTP remote origins or a switch that disables TLS verification.
- Treating arbitrary third-party pages as trusted remote review targets.
- Multi-user or multi-machine deployments.
