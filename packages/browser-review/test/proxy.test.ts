// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { rewriteLocation } from "../src/proxy.js";

const opts = {
  upstream: new URL("http://localhost:5173"),
  basePath: "/r/tok",
  selfOrigin: "http://127.0.0.1:4321",
  overlayUrl: "/r/tok/__br/overlay.js",
  overlayConfig: {},
  onWarning: () => undefined,
};

describe("rewriteLocation", () => {
  it("prefixes a relative redirect with the session path", () => {
    expect(rewriteLocation("/login", opts)).toBe("/r/tok/login");
  });

  it("follows the upstream even when it answers on a different loopback name", () => {
    expect(rewriteLocation("http://127.0.0.1:5173/app", opts)).toBe(
      "http://127.0.0.1:4321/r/tok/app",
    );
  });

  it("keeps the query and fragment", () => {
    expect(rewriteLocation("http://localhost:5173/app?a=1#b", opts)).toBe(
      "http://127.0.0.1:4321/r/tok/app?a=1#b",
    );
  });

  it("leaves a redirect to somewhere else alone", () => {
    expect(rewriteLocation("https://accounts.example.com/oauth", opts)).toBe(
      "https://accounts.example.com/oauth",
    );
  });

  it("leaves a redirect to a different local port alone", () => {
    expect(rewriteLocation("http://localhost:9999/x", opts)).toBe("http://localhost:9999/x");
  });

  it("does not throw on a malformed header", () => {
    expect(rewriteLocation("::::", opts)).toBe("::::");
  });
});
