// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import browserReview from "@browser-review/vite-plugin";

export default defineConfig({
  // browserReview() runs before the React plugin so it sees the JSX as written
  // and can record the line each element came from. It is a no-op in a build.
  plugins: [browserReview(), react()],
  server: { host: "127.0.0.1", port: 5173 },
});
