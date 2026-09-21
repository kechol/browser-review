# browser-review

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

Keyboard shortcuts: **c** toggles element selection, **l** toggles the comment
list, and **s** toggles status (connection, mode, version, and MCP URL).
Shortcuts are inactive while typing in an input or editor. **Escape** closes
the panel or cancels element selection. The comment list preserves line breaks
and displays full comments, with scrolling for longer text. In Status, use
**Copy instructions for Claude Code** to copy the MCP URL together with a
ready-to-paste review prompt.

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

|                             | `html-file`                                                     | `proxy`                                                                            |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Target**                  | a local `.html` file                                            | `http://localhost:PORT/...`                                                        |
| **How the overlay gets in** | the file is parsed and served with the overlay appended         | every response is forwarded; HTML gets the overlay spliced in                      |
| **Source hints**            | exact — every element is tagged with the line it was written on | depends on your framework; see below                                               |
| **The agent may edit**      | that one file                                                   | anything under the project directory                                               |
| **Live reload**             | yes, the server watches the file                                | your dev server's own HMR, passed straight through                                 |
| **Caveat**                  | —                                                               | a `Content-Security-Policy` from the dev server is removed so the overlay can load |

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
- macOS or Linux. **Windows is not supported**: the server, the state directory
  layout, and the browser-opening helper are all written for POSIX. A patch is
  welcome; the path handling is the bulk of it.
- Claude Code recent enough to support plugin marketplaces, plugin MCP servers,
  and `hookSpecificOutput.additionalContext` on `UserPromptSubmit`. If
  `/plugin marketplace add` is unknown to your build, update first.

## What it will not do

- **Reach the network.** The server binds to `127.0.0.1`, there is no host
  option, and nothing in the source makes an outbound request. CI fails the
  build if a non-loopback URL host appears anywhere in it.
- **Review a site you do not run.** Only local files and
  `http://localhost` / `http://127.0.0.1` upstreams are accepted.
- **Read what you typed into the page.** The overlay sends at most 500
  characters of the clicked element's markup, with `value` attributes stripped,
  and never touches form values, cookies, or browser storage.
- **Write inside your repository.** Sessions live in
  `$XDG_STATE_HOME/browser-review/`, so there is nothing to accidentally commit.

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
