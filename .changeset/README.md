# Changesets

Every user-visible change needs one. Run `pnpm exec changeset`, pick the packages and
the bump level, and describe the change in a sentence or two — the text lands
verbatim in `CHANGELOG.md`.

`@browser-review/shared` and `@browser-review/overlay` are not published: they
are bundled into `browser-review` at build time, so they are ignored here.

When `browser-review` gets a minor bump, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json` and the version range in `.mcp.json` have to
move with it. `pnpm run check:versions` fails the build if they do not.
