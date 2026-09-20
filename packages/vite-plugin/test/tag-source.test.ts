// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { tagSource } from "../src/index.js";

describe("tagSource", () => {
  it("tags a host element with the line it sits on", () => {
    const code = ["export function App() {", "  return <div>hi</div>;", "}"].join("\n");
    expect(tagSource(code, "src/App.tsx")).toContain('<div data-review-src="src/App.tsx:2:10">');
  });

  it("tags a component element too", () => {
    const code = 'const A = () => <Button label="x" />;';
    expect(tagSource(code, "src/A.tsx")).toContain('<Button data-review-src="src/A.tsx:1:17"');
  });

  it("leaves fragments alone — there is nothing to hang an attribute on", () => {
    const code = "const A = () => <><span>x</span></>;";
    const out = tagSource(code, "src/A.tsx");
    expect(out).toContain("<>");
    expect(out.match(/data-review-src/g)).toHaveLength(1);
  });

  it("keeps the number of lines, so downstream source maps still line up", () => {
    const code = ["const A = () => (", "  <div>", "    <p>x</p>", "  </div>", ");"].join("\n");
    expect(tagSource(code, "a.tsx").split("\n")).toHaveLength(code.split("\n").length);
  });

  it("does not tag the same element twice", () => {
    const once = tagSource("const A = <div>x</div>;", "a.tsx");
    expect(tagSource(once, "a.tsx")).toBe(once);
  });

  it("handles TypeScript syntax that is not JSX", () => {
    const code = "const x = foo<Bar>(1); const A = () => <div>{x}</div>;";
    expect(tagSource(code, "a.tsx")).toContain("data-review-src");
  });

  it("returns the file untouched when it cannot be parsed", () => {
    const code = "const ( = = =;";
    expect(tagSource(code, "a.tsx")).toBe(code);
  });
});

it("escapes filenames so quotes and newlines cannot break JSX", () => {
  const tagged = tagSource("const A = <div />;", 'a"&\n.tsx');
  expect(tagged).toContain("a&quot;&amp;&#10;.tsx");
  expect(tagged.split("\n")).toHaveLength(1);
  expect(tagSource(tagged, "other.tsx")).toBe(tagged);
});
