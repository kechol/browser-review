# Publication prerequisites

Repository contents and release automation do not establish ownership of a
GitHub repository or npm package name. Maintainers must complete these steps
before inviting users to install a release.

- Confirm the GitHub repository named in `repository`, package READMEs and plugin
  manifests is owned by the intended maintainer. Configure the remote, visibility
  and push access explicitly; creating a local commit does not publish anything.
- Confirm access to both npm names: `browser-review` and
  `@browser-review/vite-plugin`. Resolve any naming conflict consistently across
  package metadata, plugin manifests, documentation and the release workflow.
- Configure npm Trusted Publishing for both packages to allow this repository's
  `.github/workflows/release.yml`. The workflow requests an OIDC identity and
  publication provenance; do not commit registry credentials or local `.npmrc`.
  If the registry requires a first release before publisher configuration, use
  the first-publication procedure below and keep credentials outside the repository.
- Enable GitHub private vulnerability reporting so the reporting channel in
  `SECURITY.md` is usable, and verify that maintainers receive the reports.
- Protect the default branch with review and successful CI requirements. Confirm
  that release automation has only the permissions needed to version and publish.
- Check contribution rights and third-party notices. Use `git commit -s` for DCO
  sign-off. Cryptographic commit signing is separate from DCO certification.
- From a clean checkout, install using the lockfile, build, and run the checks in
  `CONTRIBUTING.md`. `pnpm run check:packages` packs both packages locally and
  verifies their contents without publishing. Inspect the resulting release
  version and changesets before authorizing the release workflow.

Until a release is available from the public npm registry, run the built CLI
from a source checkout as described in `CONTRIBUTING.md`. Do not describe npm
installation or the vulnerability reporting channel as verified until the
corresponding external setup has been checked.

## 1. Prepare the release

The Release workflow runs on pushes to `main` to prepare a version pull request.
A stable `v<CLI-version>` tag push publishes npm packages, then updates Homebrew
only after npm publication succeeds. Main-branch pushes never publish.
Enable **Allow GitHub Actions to create and approve pull requests** in the
repository's Actions settings for Changesets to create that PR. Review and
merge it after CI passes. Bot-created PRs may require a maintainer to trigger
CI according to the repository's Actions policy.

If Release fails with `GitHub Actions is not permitted to create or approve
pull requests`, open **Settings → Actions → General → Workflow permissions**,
enable that checkbox and save. The workflow already requests
`pull-requests: write`; that permission does not override this repository
setting. Rerun the failed job after enabling it. Do not use a personal token
to bypass the setting.

The initial changesets include a minor bump from `0.1.0`; inspect the generated
versions instead of assuming that the first publication will be `0.1.0`.
`version-packages` synchronizes plugin metadata and the pnpm lockfile. Do not
manually bump only one manifest. If preparing versions locally instead, run
`pnpm run version-packages`, review its diff and submit it with DCO sign-off.

Before publication, use a clean checkout of the versioned `main` commit:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm test
pnpm run license-check
pnpm run check:no-egress
pnpm run check:packages
pnpm run check:versions
pnpm exec playwright install chromium
pnpm run test:e2e
```

## 2. Publish to npm from GitHub Actions

Both `browser-review` and `@browser-review/vite-plugin` are public packages.
Create or obtain access to the npm `browser-review` scope for the latter, and
verify that the unscoped name is available or belongs to you. A registry 404 does
not guarantee that npm will allow a name to be registered.

### First publication when the packages do not exist

Trusted publisher settings belong to an existing npm package. If you cannot
configure them yet, bootstrap from the same Release workflow:

1. Create a short-lived npm granular access token with only the permissions
   needed to create/publish these packages and the scope. Noninteractive
   publication requires the appropriate bypass-2FA permission. Follow npm's
   current [token instructions](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
2. Save it as the GitHub Actions secret `NPM_BOOTSTRAP_TOKEN` in
   `kechol/browser-review`. Never put it in a committed file or command history.
3. Ensure the tagged commit contains this tag-triggered workflow, no pending
   changesets, and the intended versions. Push its matching tag as shown below.
   The npm job uses `NPM_BOOTSTRAP_TOKEN` automatically while it is present.
4. After both packages publish successfully, configure Trusted Publishing for
   both, revoke the temporary token and delete the repository secret. Subsequent
   tag releases use OIDC with no token.

The token must cover the unscoped `browser-review` package as well as
`@browser-review/vite-plugin`. Selecting only the `@browser-review` scope does
not authorize creation of the unscoped package. For first creation of an
unscoped package, use the token UI's **All Packages** setting with a short
expiration, **Read and write (publish and stage)**, and the required bypass-2FA
permission. Organization-management access alone is not package publish access.
Never put the token in a file committed to Git. Do not run `pnpm run release`
or `npm publish` from a laptop.

### Subsequent releases using Trusted Publishing

In each package's npm settings, add a GitHub Actions trusted publisher:

| Setting              | Value                                         |
| -------------------- | --------------------------------------------- |
| Organization or user | `kechol`                                      |
| Repository           | `browser-review`                              |
| Workflow filename    | `release.yml`                                 |
| Environment          | Leave empty; the npm job does not declare one |
| Allowed actions      | Enable direct `npm publish`                   |

The GitHub-hosted job has `id-token: write`. Package metadata requests
provenance; keep the repository public. The workflow uses pinned pnpm through
Changesets. See [npm's OIDC configuration](https://docs.npmjs.com/trusted-publishers/).

After merging the version PR and checking CI on the release commit, create and
push the matching stable CLI tag (replace the example commit and version):

```sh
git tag -s v0.2.1 <release-commit> -m "browser-review 0.2.1"
git push origin v0.2.1
```

The tagged commit must already contain the new workflow: tagging a previous
merge commit runs the workflow stored at that older commit. When migrating
from the former manual npm workflow, tag a later main commit that includes
this workflow change and still carries the intended package versions. Do not
rewrite published history or move an existing tag to retrofit the workflow.

The publish job checks that the commit belongs to `main`, its stable tag equals
`v` plus the CLI version, and no unconsumed changesets remain. Prerelease tags
are skipped. Changesets publishes only missing npm versions. This release
scheme is keyed to the CLI version; a Vite-only bump with an already-used CLI
tag needs a separately planned release path, not a reused tag.

Check the job result and exact public registry versions:

```sh
npm view browser-review@0.2.1 version dist.tarball dist.integrity --registry=https://registry.npmjs.org
npm view @browser-review/vite-plugin@0.2.0 version --registry=https://registry.npmjs.org
```

A failed job can still have published one package. Inspect its log and registry
state before retrying; do not unpublish or bump versions just to recover. A 403
for only the unscoped package commonly indicates a token limited to the org
scope. Correct the token permissions and update the repository secret. Rerun
the failed jobs or dispatch the same stable tag:

```sh
gh workflow run release.yml --ref v0.2.1 -f publish=true
```

There is no `bootstrap` input. The repository secret selects first-publication
authentication; remove it after configuring OIDC. A retry skips versions
already published and runs Homebrew only when npm publication succeeds.

Check both npm package pages for provenance and run `browser-review --help`
from an installation of the intended version in a disposable environment.

## 3. Update the Homebrew tap

The tap is [kechol/homebrew-tap](https://github.com/kechol/homebrew-tap).
The formula uses the compiled npm archive, Node.js and npm runtime dependencies;
it does not compile the monorepo or install the Claude Code plugin. No bottles
or per-architecture binaries are required. Homebrew installation needs network
access for npm dependencies. Dependency ranges are resolved at installation
time; the archive checksum pins the CLI tarball, not the whole dependency tree.

### Automatic updates

Like kura's release workflow, this repository can update the tap after a stable
release when `HOMEBREW_TAP_TOKEN` is configured:

1. Create a fine-grained GitHub token scoped only to `kechol/homebrew-tap`, with
   **Contents: Read and write**. The tap must permit that identity to push to
   its default branch. Use an expiration and rotate it when needed.
2. In `kechol/browser-review`, create the GitHub Environment **release**, allow
   deployment tags matching `v*`, and add its Environment secret
   `HOMEBREW_TAP_TOKEN`. The Homebrew job declares `environment: release` to
   access it. The repository's default `GITHUB_TOKEN` cannot write to the tap.
3. Push the stable release tag as described above. The same workflow publishes
   npm first; `needs: publish` then allows the Homebrew job to proceed.
   Changesets' package tags (such as `browser-review@0.2.1`) do not trigger
   another release.

The **Update Homebrew tap** job downloads the published CLI archive, generates
and syntax-checks the formula, and uploads a `homebrew-formula` artifact. With
the token configured, it commits only `Formula/browser-review.rb` to the tap's
default branch and pushes it. An unchanged formula creates no commit.

Without the token, formula generation still runs and the artifact is available,
but the tap push is skipped with a notice. Prereleases do not update the stable
formula. A mismatched tag or an unavailable npm archive fails before the tap
is modified. If npm publication fails, the Homebrew job is skipped.
The token is used only in the Homebrew job, not in package builds or npm publishing.

If the tap job fails, correct the token or tap problem and rerun that job.
You may also dispatch Release on the same tag; npm skips existing versions:

```sh
gh workflow run release.yml --ref v0.2.1 -f publish=true
```

Do not rerun an older release to roll the tap back unintentionally. CI checks
Ruby syntax; verify Homebrew installation with the commands below before
describing the tap installation as tested. Add the install command to the tap
README separately on its first release.

### Manual generation and installation checks

After npm publication, run the following from this repository. Set the version
to the exact release you just verified (the number below is an example):

```sh
release_version=0.2.1
mkdir -p .output/homebrew
curl --fail --location --proto '=https' --proto-redir '=https' \
  "https://registry.npmjs.org/browser-review/-/browser-review-${release_version}.tgz" \
  --output ".output/homebrew/browser-review-${release_version}.tgz"
pnpm homebrew:formula ".output/homebrew/browser-review-${release_version}.tgz"
ruby -c .output/homebrew/browser-review.rb
```

The generator checks package identity, stable version, CLI entry point and
required files, then computes SHA-256 over those exact bytes. It writes
`.output/homebrew/browser-review.rb` and never modifies the tap. Do not generate
the release checksum from a locally rebuilt archive: its bytes may differ.
Prereleases are intentionally rejected for this stable formula.

In a local clone of the tap, copy the generated file to
`Formula/browser-review.rb` and add its installation command to the tap README.
Review the version, URL, checksum and diff. Test using Homebrew's tap checkout
(if you already have it, use `brew --repository kechol/tap` to locate it):

```sh
brew tap kechol/tap
cp .output/homebrew/browser-review.rb "$(brew --repository kechol/tap)/Formula/browser-review.rb"
brew style kechol/tap/browser-review
brew install --build-from-source kechol/tap/browser-review
brew test kechol/tap/browser-review
brew audit --strict kechol/tap/browser-review
```

If already installed, use `brew reinstall --build-from-source` instead. The
formula test checks CLI help and isolated empty session state. The npm install
disables lifecycle scripts because the archive is prebuilt and the package's
repository-only `prepack` helper is not distributed. Follow the
[Homebrew Node formula guidance](https://docs.brew.sh/Language-Specific-Formulae#nodejs).

If using the manual path, commit the reviewed formula and README in
`kechol/homebrew-tap` and push them when ready. With automatic updates, the
workflow handles the formula commit. End users can then run:

```sh
brew install kechol/tap/browser-review
browser-review --help
```

For later releases, the configured workflow handles formula updates; without
the token, repeat the manual download, generation, tap tests and tap commit.
Users update with `brew update && brew upgrade browser-review`. Publication and
installation are not considered verified until these external steps succeed.
