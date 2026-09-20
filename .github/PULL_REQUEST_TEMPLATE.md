## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What was wrong or missing. Skip if the "what" already says it. -->

## Checklist

- [ ] `npm run build && npm test` passes
- [ ] `npm run format:check && npm run lint && npm run typecheck` passes
- [ ] A changeset is included (`npx changeset`), or this change is invisible to users
- [ ] Commits are signed off (`git commit -s`) — see CONTRIBUTING.md
- [ ] No company names, internal hostnames, personal email addresses, or real
      product content added anywhere, including test fixtures

## Design constraints

Confirm this change keeps the promises in SECURITY.md:

- [ ] Still binds to `127.0.0.1` only
- [ ] Still makes no outbound network requests
- [ ] Still writes nothing inside the repository under review
- [ ] The overlay still reads no form values, cookies, or browser storage
