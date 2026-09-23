# browser-review

English | [日本語](README.ja.md)

Point at something in your browser, say what is wrong with it, and let the
coding agent already running on your machine find and fix the code behind it.

No more "the spacing under the third card is off — no, the _third_ one". You
click the card. The agent gets the file and the line.

browser-review is a [Claude Code][cc] plugin, and also a plain npm package that
any MCP-speaking agent — or a shell script with `curl` — can use.

> **Not an Anthropic project.** browser-review is an independent, third-party
> tool. It is not affiliated with, endorsed by, or sponsored by Anthropic PBC.
> "Claude" and "Claude Code" are their trademarks, used here only to say what
> this works with.

## What it does

```
/browser-review:open ./landing.html        # or http://localhost:5173
```

A review server starts on `127.0.0.1` and hands you a URL. Open it: your page,
exactly as it was, with a small toolbar in the corner. Hit **Comment**, click
anything, type what should change.

Click the connection indicator, or press **s**, to toggle status (connection,
mode, version, and MCP URL). Other keyboard shortcuts are **c** for element
selection and **l** for the comment list. `Cmd + \` hides or shows the entire review UI, preserving open panels and
comment drafts. While hidden, review shortcuts and element picking are paused.
The c/l/s shortcuts are inactive while typing in an input or editor. **Escape** closes
the panel or cancels element selection. The comment list preserves line breaks
and displays full comments, with scrolling for longer text. In the status panel, use
**Copy instructions for Claude Code** to copy the MCP URL together with a
ready-to-paste review prompt.

Pins follow an element only while its saved tag and available text, ARIA, data,
or source hints still identify one unambiguous match. If the element disappears,
becomes ambiguous, or belongs to another path, the comment remains readable in
the list and card as an unconfirmed position instead of being pinned to a likely
wrong element. DOM and layout changes are coalesced into animation-frame updates.
After a WebSocket reconnect, the list, pins, and open card resynchronize while an
unsent reply, its focus, and selection stay in the current tab.

```
/browser-review:resolve
```

The agent waits for comments, follows them back to the code, makes the change,
and marks the pin green in your browser. If it cannot tell which of three
buttons you meant, it asks — in a bubble on the pin you created — and picks up
your answer from there.

You can also hand the review to a _different_ Claude Code session, which is the
point of the whole design: review in one window, fix in another, with the
repository open where the code actually lives.

## Install

The npm and Homebrew commands below apply after the first releases have been
published. Maintainers should follow [the publishing guide](docs/publishing.md).

For a standalone CLI (Node.js 24 or newer):

```sh
npm install --global browser-review
```

Or install the CLI and Node.js through Homebrew:

```sh
brew install kechol/tap/browser-review
```

The Homebrew formula installs the CLI. Register the Claude Code plugin separately
if you want its commands and hooks. The optional Vite integration is installed
in the application with `npm install --save-dev @browser-review/vite-plugin`.

### 1. As a Claude Code plugin (recommended)

```
/plugin marketplace add kechol/browser-review
/plugin install browser-review@browser-review
```

That gives you four commands — `open`, `resolve`, `status`, `close` — and a
hook that drops waiting comments into your next prompt so you notice them
without asking.

### 2. From a clone, for development

```sh
git clone https://github.com/kechol/browser-review.git
cd browser-review && pnpm install && pnpm run build
```

Then add the clone as a local marketplace. Local marketplaces are loaded in
place, so a rebuild is picked up without reinstalling:

```
/plugin marketplace add ./browser-review
/plugin install browser-review@browser-review
```

### 3. Without the plugin, or without Claude Code

```sh
npx browser-review open ./landing.html --json
```

It prints a `handoffMcpUrl`. Point any MCP client at it:

```sh
claude mcp add --transport http review "$HANDOFF_MCP_URL"
```

Or skip MCP entirely and talk to the HTTP feed with `curl` — see
[docs/other-agents.md](docs/other-agents.md).

## The two modes

|                             | `html-file`                                                     | `proxy`                                                                                         |
| --------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Target**                  | a local `.html` file                                            | localhost HTTP, or an explicitly allowed trusted HTTPS staging origin                           |
| **How the overlay gets in** | the file is parsed and served with the overlay appended         | every response is forwarded; HTML gets the overlay spliced in                                   |
| **Source hints**            | exact — every element is tagged with the line it was written on | depends on your framework; see below                                                            |
| **The agent may edit**      | that one file                                                   | anything under the project directory                                                            |
| **Live reload**             | yes, the server watches the file                                | your dev server's own HMR/WSS, passed through                                                   |
| **Caveat**                  | —                                                               | upstream CSP is removed; remote mode trusts the reviewed page and has stricter credential rules |

### Trusted staging origins

Remote proxying is off by default. To review a staging deployment that you own
and trust, opt in for that invocation:

```sh
npx browser-review open https://staging.example.test/admin --allow-remote --json
```

To reuse an exact origin without repeating `--allow-remote`, register it
explicitly. Trust applies only to later session startups; removal does not
disconnect an already running session.

```sh
npx browser-review trust add https://staging.example.test
npx browser-review trust list
npx browser-review trust remove https://staging.example.test
```

Only exact HTTPS origins are accepted—no paths, credentials, or wildcards.
Registration does not bypass DNS pinning, unsafe-address rejection, or TLS
verification, and stores no credentials.

The review server still listens only on `127.0.0.1`. A remote target must be one
HTTPS origin with no URL credentials. Its DNS answers are resolved once at
startup, rejected if they are loopback, unspecified, link-local, or multicast,
then pinned for the session. TLS certificate and hostname verification remain
enabled for HTTPS and WSS.

Local HTTPS is supported too. A development or staging CA can be scoped to one
session with `--ca-file`; without it, Node's standard trust roots are used.
There is deliberately no insecure-TLS option.

```sh
npx browser-review open https://localhost:5173 --ca-file ./test-ca.pem --json
```

Remote mode does not forward browser cookies, `Authorization`, a token-bearing
`Referer`, or client-supplied forwarding headers. Instead, it keeps upstream
cookies in a per-session in-memory jar and strips upstream cookie, authentication
challenge, site-data, and reporting headers from browser responses. If staging
uses Basic or Bearer authentication, provide exactly one credential through the
`BROWSER_REVIEW_REMOTE_AUTHORIZATION` environment variable; it is never written
to the session file or command line. Prefer a read-only staging account.

For an existing browser-independent authenticated session, pass a Netscape
cookie jar. The file is read once by the detached session process, is never
copied into state or printed, and is limited to 1 MiB and 1,000 records.
Cookies outside the selected scheme, host, port, domain, path, or lifetime are
not sent. `Set-Cookie` updates and deletions remain inside that session's
in-memory jar for HTTP and WebSocket requests.

```sh
npx browser-review open https://staging.example.test/admin \
  --cookie-file ./staging-cookies.txt --json
```

This is for a trusted, self-managed staging origin, not arbitrary third-party
pages. The page and its scripts can observe the tokenized review path and reach
the review control channel. CSP is removed so the overlay can load, and absolute
URLs in the page are not rewritten, so the browser may fetch them directly.
See [docs/modes.md](docs/modes.md) and [SECURITY.md](SECURITY.md) before using it.

## How it finds the code

When you click an element, the overlay collects every lead it can and sorts
them by how directly each one maps a DOM node back to a source location:

| confidence | lead        | where it comes from                                                                               |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------- |
| 0.95       | `loc`       | a `data-review-src` attribute — put there by the file server, or by `@browser-review/vite-plugin` |
| 0.90       | `loc`       | Svelte's `__svelte_meta`, or React's `_debugSource`                                               |
| 0.80       | `component` | the React / Vue component chain around the element                                                |
| 0.70       | `data`      | `data-testid`, `data-cy`, `id`, and friends                                                       |
| 0.60       | `css`       | the stylesheet rule that matches it                                                               |
| 0.40       | `selector`  | a generated CSS selector, plus the visible text and bounding box                                  |

The agent works down that list and stops at the first lead that lands. A `loc`
hint is a file and a line, so it reads it directly; everything below is
something to grep for.

**React 19 removed `_debugSource`**, so on a modern React app the DOM alone no
longer says where an element came from. That is what
`@browser-review/vite-plugin` is for:

```ts
import browserReview from "@browser-review/vite-plugin";

export default defineConfig({
  plugins: [browserReview(), react()], // dev only, no-op in a build
});
```

It tags JSX elements with `data-review-src` by splicing the attribute into your
source at Babel's reported offsets — no re-generation, no line-number drift.
See [`examples/vite-react`](examples/vite-react).

## Requirements

- Node.js 24 or newer
- macOS or Linux. Windows CLI support is experimental and best-effort: build,
  path-boundary, state-store, and open/status/close smoke coverage runs in CI,
  but native Windows hardware has not been verified for this change. Open the
  returned URL manually. Claude Code hook expansion and every filesystem/ACL or
  process environment are not claimed to work.
- Claude Code recent enough to support plugin marketplaces, plugin MCP servers,
  and `hookSpecificOutput.additionalContext` on `UserPromptSubmit`. If
  `/plugin marketplace add` is unknown to your build, update first.

## What it will not do

- **Expose the review server to the network.** It always binds to `127.0.0.1`
  and has no host option. The only outbound capability is the explicit, pinned
  proxy upstream; CI rejects fixed remote destinations and network primitives
  outside that implementation.
- **Safely sandbox an arbitrary site.** Local targets remain the default. Remote
  proxying requires `--allow-remote`, HTTPS, and a trusted origin you control.
- **Read what you typed into the page.** The overlay sends at most 500
  characters of the clicked element's markup, with `value` attributes stripped,
  and never touches form values, cookies, or browser storage.
- **Write inside your repository.** Sessions live in `~/.browser-review/` by
  default, or `$XDG_STATE_HOME/browser-review/` when that variable is non-empty,
  so there is nothing to accidentally commit.

The previous fallback, `~/.local/state/browser-review/`, is not searched,
migrated, or deleted automatically. Stop existing sessions before changing
roots. To keep using it, set `XDG_STATE_HOME="$HOME/.local/state"`; otherwise a
manual copy is optional after every related process has stopped.

### One thing to keep in mind

An annotation is text from a web page, and it ends up in an agent's context.
Every surface that carries it — the MCP tool descriptions, the prompt hook, the
skills — says in so many words that the comment is a remark about a user
interface and not an instruction. That framing helps; it is not a guarantee.
Read the diff before you commit it, the same as you would for any other change
driven by input you did not write.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Documentation

- [docs/modes.md](docs/modes.md) — what each mode can and cannot do
- [docs/source-hints.md](docs/source-hints.md) — every hint strategy, and what breaks it
- [docs/other-agents.md](docs/other-agents.md) — using this from something that is not Claude Code
- [docs/architecture.md](docs/architecture.md) — how the pieces fit together
- [CONTRIBUTING.md](CONTRIBUTING.md) — development, tests, DCO, releases

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

[cc]: https://code.claude.com/docs/en/overview
