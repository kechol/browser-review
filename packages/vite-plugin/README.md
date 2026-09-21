# @browser-review/vite-plugin

Add source-file and line hints to JSX elements during Vite development so
browser-review can identify the code behind a selected element.

Requires Node.js 24 or newer and Vite 5 or newer.

```sh
pnpm add -D @browser-review/vite-plugin
```

```ts
import { defineConfig } from "vite";
import browserReview from "@browser-review/vite-plugin";

export default defineConfig({
  plugins: [browserReview()],
});
```

Place this plugin before framework plugins that transform JSX. It does not add
source attributes to production builds. The development attributes contain paths
relative to the Vite project root; treat them as source metadata when sharing pages.

See the [project documentation](https://github.com/kechol/browser-review#readme)
for the browser review CLI and Claude Code plugin.

Licensed under Apache-2.0. See LICENSE and NOTICE. The runtime dependency
`@babel/parser` is distributed separately under the MIT license.
