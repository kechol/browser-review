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

browser-review runs entirely on one machine. The review server binds to
`127.0.0.1` only, there is no `--host` option, and the project makes no outbound
network requests of its own. The threats we design against are therefore local.

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

## Out of scope

- Exposing the server beyond `127.0.0.1`. There is no supported way to do this.
- Reviewing pages on remote origins. Only local files and `http://localhost` /
  `http://127.0.0.1` upstreams are accepted.
- Multi-user or multi-machine deployments.
