---
name: release
description: Prepare a browser-review release using Changesets, validate package and plugin versions, and prepare a release PR. Use for /release, preparing the next release, or a release version bump in this repository. Stops before merging, tagging, or publishing npm and Homebrew releases.
---

# Prepare a browser-review release

Prepare a reviewable version change and maintainer handoff. Read the repository's
`AGENTS.md`, `CONTRIBUTING.md`, [publishing guide](../../../docs/publishing.md),
`.changeset/config.json`, and `.github/workflows/release.yml` before acting.
Resolve all commands from the repository root.

## Release model

- Changesets determines versions independently for `browser-review` and
  `@browser-review/vite-plugin`. The root package is private; its version is not
  the release version. Do not apply kura's single-package version algorithm.
- Pushes to `main` let Changesets prepare a version PR on
  `changeset-release/main`. Merging it does not publish npm packages.
- A maintainer dispatches `release.yml` on `main` with `publish=true` to publish
  npm packages. First publication may also need `bootstrap=true`; subsequent
  releases use npm Trusted Publishing. See the publishing guide for setup.
- After npm publication, the maintainer pushes `v<CLI-version>` at the published
  commit. The Homebrew job uses the `release` Environment and its
  `HOMEBREW_TAP_TOKEN`. Changesets' `browser-review@<version>` tags do not trigger
  that job. A Vite-only release normally needs no new Homebrew tag.

This skill does not merge PRs, create or push tags, dispatch publication
workflows, run `pnpm run release`, or update the tap. Push a preparation branch
and open a PR only when the user's request authorizes those actions; otherwise
finish local preparation and present the concrete diff before requesting that
authorization. Never push directly to `main` or force-push.

## Inspect before changing versions

1. Inspect the working tree, branch, configured remote and local instructions.
   Preserve staged and uncommitted work. If unrelated changes are present,
   inspect them without consuming or committing them; use a clean isolated
   worktree for version preparation when appropriate. Do not silently omit
   requested unreleased changes by preparing from an older commit.
2. Fetch `origin` and compare the intended base with `origin/main`. Confirm the
   exact commit being prepared. Check authentication before GitHub operations.
3. Look for an existing open version PR, including `changeset-release/main` and
   `codex/release-*` branches. Read its diff and checks before doing anything
   else. If it already contains the intended version changes, validate and hand
   off that PR instead of opening a duplicate or bumping twice. Do not overwrite
   a bot-owned branch.
4. Inspect CI for the exact base commit, not just the most recent workflow run.
   Report failed or pending required checks. Do not describe a release as ready
   while those checks remain unresolved.
5. Read the two public package manifests, pending `.changeset/*.md` files
   (excluding README), and their changelogs. Check the relevant package release
   tags and commit history for missing user-visible release notes. No previous
   tag is valid for a first release; inspect history from the root in that case.

Use `pnpm exec changeset status --output .output/release-status.json` to inspect
the planned package versions; create `.output/` first. This output is scratch
data, not a committed release artifact.

## Plan and apply the version change

Present current and proposed versions per package, the changesets driving each
bump, and any missing release notes. Treat existing changesets as the source of
the bump decision. Conventional Commits help find missing notes; they do not
override the Changesets plan. Do not assume the first release is `0.1.0` or
that both public packages will always share a version.

For missing changesets, add a concise English note for the affected public
packages and the appropriate patch/minor/major bump. Respect an explicit user
version request by adjusting the release plan consistently; do not hand-edit a
single manifest to force it. Ask only when the intended scope or compatibility
change cannot be determined. If there are no pending changesets and no missing
user-visible changes, report that no new version preparation is needed.

For a new local preparation, create a branch under `codex/release-` named for
the actual package/version being released. Avoid collisions with existing
branches. Run:

```sh
pnpm install --frozen-lockfile
pnpm run version-packages
```

`version-packages` runs Changesets, synchronizes plugin metadata, formats it,
and refreshes the lockfile. Review the resulting changes to:

- Public package manifests and their `CHANGELOG.md` files.
- Consumed changeset files and `pnpm-lock.yaml`, if changed.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.mcp.json`,
  which follow the CLI version and supported npx range.

Keep private packages private and preserve their workspace relationships. Do
not manually bump the root package, generate or commit a Homebrew formula, or
add local package archives. Never run `version-packages` a second time to solve
a partially failed first run without first inspecting the diff and remaining
changesets.

## Validate and prepare the PR

Run the pre-publication checks listed in the publishing guide, including build
before package and E2E checks. Run them against the final versioned tree.
Distinguish application failures from unavailable infrastructure, and report
any incomplete checks. Format only changed files when correcting formatting.
Inspect the actual package contents through `pnpm run check:packages`; verify
plugin consistency through `pnpm run check:versions`.

Review and stage only the release files. Create a Conventional Commit such as
`chore(release): prepare browser-review <version>`, with the repository's
required Why, How and Validation evidence. Include both package versions when
both change. Use the configured contributor identity, DCO sign-off and configured
cryptographic signing; never bypass hooks or signing errors.

If branch push and PR creation are authorized, push that branch and create the
PR against `main`. Write the PR body to `.output/release-pr.md` and pass it with
`gh pr create --body-file`; do not interpolate multiline prose into shell code.
Include:

- Old and new versions for each affected package and user-visible highlights.
- Plugin/npx synchronization and relevant compatibility changes.
- Checks actually completed and remaining blockers.
- The maintainer checklist below, using the actual planned versions.

When only local preparation is authorized, stop with the commit, diff, check
results and proposed PR body ready for review. Do not claim a PR exists until
GitHub returns its URL.

## Maintainer handoff

Report the existing or newly created PR URL, or the local preparation branch
and commit if no PR was authorized. Include remaining checks and these next
steps, without executing them:

1. Review and merge the version PR after its required checks pass.
2. Dispatch Release on the versioned `main` with `publish=true`; use the
   first-publication bootstrap procedure only if needed.
3. Verify the expected versions and provenance on npm. Record the actual
   published commit before tagging; do not assume a later `main` HEAD is it.
4. If the CLI changed, push its matching stable `v<CLI-version>` tag on that
   commit. Verify the Homebrew job and tap update, or download the formula
   artifact when the Environment secret is absent. No tag is needed solely
   for a Vite plugin update.

Publication remains the maintainer's action. Do not rerun an older tag or
rewrite a published tag to recover a failure; use the publishing guide's
same-version retry procedure and report what has already been published.
