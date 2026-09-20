// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { injectOverlay, instrumentHtml } from "../src/instrument.js";

const PAGE = `<!doctype html>
<html>
  <head><title>t</title><style>.a{color:red}</style></head>
  <body>
    <h1 class="title">Hello</h1>
    <p>Body</p>
  </body>
</html>
`;

describe("instrumentHtml", () => {
  const out = instrumentHtml(PAGE, "page.html");

  it("points each element at the line it was written on", () => {
    expect(out).toContain('<h1 data-review-src="page.html:5:5" class="title">');
    expect(out).toContain('<p data-review-src="page.html:6:5">');
  });

  it("leaves elements nobody can click alone", () => {
    expect(out).not.toMatch(/<title data-review-src/);
    expect(out).not.toMatch(/<style data-review-src/);
    expect(out).not.toMatch(/<html data-review-src/);
  });

  it("keeps the rest of the file byte for byte, so line numbers still hold", () => {
    expect(out.replace(/ data-review-src="[^"]*"/g, "")).toBe(PAGE);
  });

  it("does not tag an element that already carries the attribute", () => {
    const tagged = instrumentHtml('<div data-review-src="x.tsx:1:1">hi</div>', "page.html");
    expect(tagged.match(/data-review-src/g)).toHaveLength(1);
  });

  it("returns the input unchanged rather than throwing on junk", () => {
    expect(instrumentHtml("", "page.html")).toBe("");
  });
});

describe("injectOverlay", () => {
  it("puts the loader last inside body", () => {
    const out = injectOverlay("<html><body><p>x</p></body></html>", "/o.js", { a: 1 });
    expect(out).toContain('<p>x</p><script src="/o.js" defer');
    expect(out.indexOf("<script")).toBeLessThan(out.indexOf("</body>"));
  });

  it("carries its configuration on the tag, so no inline script is needed", () => {
    const out = injectOverlay("<body></body>", "/o.js", { mode: "proxy" });
    expect(out).toContain("data-browser-review=");
    expect(out).toContain("&quot;mode&quot;:&quot;proxy&quot;");
  });

  it("still injects into a fragment with no body", () => {
    expect(injectOverlay("<p>x</p>", "/o.js", {})).toContain("<script");
  });
});
