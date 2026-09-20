// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    // Session-store tests write to a shared XDG directory per file; give each
    // file its own process so one cannot see another's sessions.
    pool: "forks",
  },
});
