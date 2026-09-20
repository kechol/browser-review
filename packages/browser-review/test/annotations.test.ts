// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createAnnotation, stripValueAttributes, summarizeHint } from "../src/annotations.js";

describe("stripValueAttributes", () => {
  it("removes what someone typed into a form, in every quoting style", () => {
    expect(stripValueAttributes('<input value="hunter2">')).not.toContain("hunter2");
    expect(stripValueAttributes("<input value='hunter2'>")).not.toContain("hunter2");
    expect(stripValueAttributes("<input value=hunter2>")).not.toContain("hunter2");
  });

  it("leaves other attributes alone", () => {
    const html = '<input name="email" value="a@example.com" placeholder="Email">';
    const out = stripValueAttributes(html);
    expect(out).toContain('name="email"');
    expect(out).toContain('placeholder="Email"');
    expect(out).not.toContain("a@example.com");
  });
});

describe("createAnnotation", () => {
  const draft = {
    comment: "  Make this bigger.  ",
    page: { url: "http://127.0.0.1:1/r/t/", path: "/r/t/", title: "Demo" },
    element: { outerHtmlHead: '<h1 value="leak">Hi</h1>', tag: "H1" },
    sourceHints: [
      {
        kind: "selector" as const,
        value: "h1",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        confidence: 0.4,
      },
      {
        kind: "loc" as const,
        file: "a.html",
        line: 3,
        col: 2,
        confidence: 0.95,
        via: "data-review-src" as const,
      },
    ],
  };

  it("starts pending with a sortable id", () => {
    const annotation = createAnnotation("s1", draft);
    expect(annotation.status).toBe("pending");
    expect(annotation.id).toMatch(/^a_[0-9A-Z]{26}$/);
    expect(annotation.sessionId).toBe("s1");
  });

  it("trims the comment and lowercases the tag", () => {
    const annotation = createAnnotation("s1", draft);
    expect(annotation.comment).toBe("Make this bigger.");
    expect(annotation.element.tag).toBe("h1");
  });

  it("orders hints by confidence so the best lead is first", () => {
    const annotation = createAnnotation("s1", draft);
    expect(annotation.sourceHints[0]?.kind).toBe("loc");
    expect(annotation.sourceHints[1]?.kind).toBe("selector");
  });

  it("strips form values even when the page claims otherwise", () => {
    const annotation = createAnnotation("s1", draft);
    expect(annotation.element.outerHtmlHead).not.toContain("leak");
  });

  it("drops hints it cannot make sense of instead of trusting them", () => {
    const annotation = createAnnotation("s1", {
      ...draft,
      sourceHints: [
        { kind: "loc", file: "", line: 0, confidence: 2, via: "nonsense" },
        { kind: "unknown-kind", confidence: 1 },
        { kind: "component", chain: ["Button"], confidence: 0.8 },
      ] as never,
    });
    expect(annotation.sourceHints).toHaveLength(1);
    expect(annotation.sourceHints[0]).toMatchObject({ kind: "component", chain: ["Button"] });
  });

  it("clamps a confidence the page made up", () => {
    const annotation = createAnnotation("s1", {
      ...draft,
      sourceHints: [{ kind: "component", chain: ["X"], confidence: 99 }] as never,
    });
    expect(annotation.sourceHints[0]?.confidence).toBe(1);
  });
});

describe("summarizeHint", () => {
  it("renders each kind as one readable line", () => {
    expect(
      summarizeHint({ kind: "loc", file: "a.tsx", line: 4, col: 2, confidence: 1, via: "parse5" }),
    ).toBe("a.tsx:4:2 (parse5)");
    expect(summarizeHint({ kind: "component", chain: ["App", "Button"], confidence: 0.8 })).toBe(
      "App > Button",
    );
    expect(summarizeHint({ kind: "data", attrs: { "data-testid": "cta" }, confidence: 0.7 })).toBe(
      'data-testid="cta"',
    );
  });
});
