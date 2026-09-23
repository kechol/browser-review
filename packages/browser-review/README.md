# browser-review

Review a local HTML page or a localhost development server in your browser, then
send element-specific comments and source hints to an MCP-compatible coding agent.

Requires Node.js 24 or newer. macOS and Linux are supported; Windows CLI support
is experimental and best-effort.

```sh
npx browser-review open ./page.html --json
# Or review a local development server:
npx browser-review open http://localhost:5173 --json
# Or explicitly opt in to a trusted HTTPS staging origin:
npx browser-review open https://staging.example.test --allow-remote --json
# Optional, session-scoped authentication and TLS trust:
npx browser-review trust add https://staging.example.test
npx browser-review open https://staging.example.test \
  --cookie-file ./cookies.txt --ca-file ./ca.pem --json
```

Open the returned review URL. The returned MCP URL lets an agent connect over
Streamable HTTP. Keep these URLs private: they contain a session access token.

```sh
npx browser-review status --json
npx browser-review close --session latest
```

The CLI always listens on loopback. Remote proxying is off by default, HTTPS
only, DNS-pinned, and intended solely for a self-managed staging origin you
trust. Browser credentials are not forwarded; upstream cookies and an optional
`BROWSER_REVIEW_REMOTE_AUTHORIZATION` Basic/Bearer value are isolated in the
session process. TLS verification stays enabled.

State lives in `~/.browser-review` by default, or under a non-empty
`$XDG_STATE_HOME`. Older fallback state is not automatically migrated.

Review comments, page text, URLs, source hints and optional screenshots may enter
the connected agent's context; form-value filtering is not general-purpose
anonymization. Use fictional data when sharing examples.

See the [project documentation](https://github.com/kechol/browser-review#readme)
for the Claude Code plugin, session handoff, and usage details.

Licensed under Apache-2.0. See LICENSE and NOTICE. This independent project is not
affiliated with Anthropic; Claude and Claude Code are their trademarks.
