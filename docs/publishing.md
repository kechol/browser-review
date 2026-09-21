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
  its documented bootstrap process and keep credentials outside the repository.
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
