# Example: Vite + React in proxy mode

A fictional dashboard, used to show browser-review pointing at a running dev
server rather than a static file.

From the repository root (Node.js 24+ and pnpm 12.5.1):

```sh
pnpm install
pnpm run build
pnpm --filter browser-review-example-vite-react dev # http://127.0.0.1:5173
```

Then, from the repository root:

```sh
node packages/browser-review/dist/cli.js open http://localhost:5173
```

or, inside Claude Code with the plugin installed:

```
/browser-review:open http://localhost:5173
```

Click _Comment_ in the overlay, then click one of the buttons. Because
`vite.config.ts` includes `@browser-review/vite-plugin`, the annotation arrives
carrying `src/components/Button.tsx` and the exact line — no grepping required.

Take the plugin out of `vite.config.ts` and the same click still works, but the
agent has to fall back to the component name and a CSS selector. That
difference is the whole point of the plugin.
