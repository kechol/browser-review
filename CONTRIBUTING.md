# Contributing to browser-review

Thanks for taking the time to contribute. This document covers the development
setup, the checks that must pass, and how changes get released.

## Requirements

- Node.js 24 or newer
- pnpm 12.5.1 (pinned in `packageManager`)
- macOS or Linux (Windows is not supported — see the README)

## Getting set up

```sh
git clone https://github.com/kechol/browser-review.git
cd browser-review
pnpm install
pnpm run build
```

`pnpm run build` compiles the shared types, bundles the browser overlay into
`packages/browser-review/dist/overlay.js`, and bundles the CLI into
`packages/browser-review/dist/cli.js`.

## Trying your changes

Run the CLI straight from the workspace:

```sh
node packages/browser-review/dist/cli.js open ./examples/static/page.html
```

To exercise the whole plugin inside Claude Code, register this repository as a
local marketplace. It is loaded in place, so a rebuild is picked up without
reinstalling:

```
/plugin marketplace add ./path/to/browser-review
/plugin install browser-review@browser-review
```

## Checks

Every one of these runs in CI and must pass:

```sh
pnpm run format:check   # oxfmt
pnpm run lint           # oxlint
pnpm run typecheck      # tsc --build
pnpm test               # vitest
pnpm run license-check  # dependency licenses must be MIT / Apache-2.0 / BSD / ISC
pnpm run check:no-egress # no outbound network targets other than loopback/upstream
pnpm run check:packages  # built tarballs include the current license, notices and README
pnpm run check:versions  # plugin.json version matches the published package
pnpm run test:e2e       # playwright (needs `pnpm exec playwright install chromium` once)
```

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin][dco]
(DCO). There is no CLA. Sign off each commit:

```sh
git commit -s -m "fix: ..."
```

The `-s` flag appends a `Signed-off-by:` trailer, which certifies that you wrote
the patch or otherwise have the right to submit it under Apache-2.0.

## Commit messages

We use [Conventional Commits][cc]: `feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`, `ci:`. The scope is optional and usually the package name,
for example `feat(overlay): ...`.

## Changesets and releases

Every user-visible change needs a changeset:

```sh
pnpm exec changeset
```

Pick the affected packages and the bump level, and describe the change in one or
two sentences — the text lands verbatim in `CHANGELOG.md`.

Releases are cut by maintainers: merging the "Version Packages" pull request
prepares the release. A maintainer then pushes a matching stable
`v<CLI-version>` tag to publish npm from GitHub Actions, followed by Homebrew.
After first-publication bootstrap, npm uses Trusted Publishing with provenance. **Nobody publishes from a laptop.** When the
version of `packages/browser-review` changes, `.claude-plugin/plugin.json` must
be bumped in the same pull request; `pnpm run check:versions` enforces this.

Before enabling a first release, complete the [publication prerequisites](docs/publishing.md).

## What to keep out of the repository

This is a public repository. Please do not add:

- Real company names, internal hostnames, or internal project names
- Personal email addresses (the `author` field is a GitHub account name only)
- Screenshots or copy taken from a real product — examples must be fictional
- Absolute paths containing a developer's home directory, including in test
  fixtures; use `/tmp` or paths relative to the repository root

## Design constraints

Pull requests that break one of these will be asked to change:

- The server binds to `127.0.0.1` only. Do not add a host or interface option.
- The only outbound request target is the explicit, validated proxy upstream.
  `pnpm run check:no-egress` fails the build if network primitives escape the
  dedicated proxy/upstream modules or a fixed non-loopback target appears.
- Nothing is written inside the user's repository. Session state lives under
  `$XDG_STATE_HOME/browser-review/`.
- The overlay never reads form values, cookies, or browser storage.

[dco]: https://developercertificate.org/
[cc]: https://www.conventionalcommits.org/en/v1.0.0/
