// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const CLI = path.resolve("packages/browser-review/dist/cli.js");
let dir: string;
let stateHome: string;
let pageFile: string;
let session: { sessionId: string; reviewUrl: string; token: string; port: number };

function cli(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
}

function control(route: string): string {
  return `http://127.0.0.1:${session.port}/r/${session.token}/__br/${route}`;
}

test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-reliability-"));
  stateHome = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-reliability-state-"));
  pageFile = path.join(dir, "reliability.html");
  await fs.copyFile("e2e/fixtures/reliability.html", pageFile);
});

test.beforeEach(() => {
  session = JSON.parse(cli("open", pageFile, "--project-dir", dir, "--json"));
});

test.afterEach(() => {
  try {
    cli("close", "--session", session.sessionId);
  } catch {
    // The test may intentionally interrupt the connection.
  }
});

test.afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(stateHome, { recursive: true, force: true });
});

async function annotate(page: Page, selector: string, comment: string): Promise<string> {
  await page.goto(session.reviewUrl);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.locator('#browser-review-overlay [data-action="annotate"]').click();
  await page.locator(selector).click({ force: true });
  const composer = page.locator("#browser-review-overlay .composer");
  await composer.locator("textarea").fill(comment);
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  const rows = async () =>
    (
      (await (await fetch(control("annotations"))).json()) as {
        annotations: Array<{ id: string; comment: string }>;
      }
    ).annotations;
  await expect.poll(async () => (await rows()).some((row) => row.comment === comment)).toBe(true);
  return (await rows()).find((row) => row.comment === comment)!.id;
}

async function openComments(page: Page): Promise<void> {
  await page.locator('#browser-review-overlay [data-action="list"]').click();
  await expect(page.locator("#browser-review-overlay .panel")).toBeVisible();
}

test("tracks the original element instead of a new nth-of-type occupant", async ({ page }) => {
  await annotate(page, ".unstable-target", "Track the target action");
  await page.locator("#unstable-list").evaluate((parent) => {
    const decoy = document.createElement("button");
    decoy.className = "decoy";
    decoy.textContent = "Inserted action";
    parent.prepend(decoy);
  });

  await expect
    .poll(async () => {
      const target = await page.locator(".unstable-target").boundingBox();
      const pin = await page.locator("#browser-review-overlay .pin").boundingBox();
      return target && pin ? Math.abs(pin.y + 11 - target.y) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(3);
});

test("follows a stable id move without scroll or resize", async ({ page }) => {
  await annotate(page, "#stable-target", "Track the stable action");
  await page.evaluate(() => {
    document.querySelector("#move-destination")!.append(document.querySelector("#stable-target")!);
  });
  const target = await page.locator("#stable-target").boundingBox();
  await expect
    .poll(async () => (await page.locator("#browser-review-overlay .pin").boundingBox())?.y)
    .toBeCloseTo(target!.y - 11, 0);
});

test("keeps long-text annotations pinned and treats identical prefixes as ambiguous", async ({
  page,
}) => {
  await page.goto(session.reviewUrl);
  const text = "Long review text ".repeat(12);
  await page.locator("#stable-target").evaluate((node, value) => {
    node.textContent = value;
  }, text);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.keyboard.press("c");
  await page.locator("#stable-target").click({ force: true });
  await page.locator("#browser-review-overlay .composer textarea").fill("Long text target");
  await page
    .locator("#browser-review-overlay .composer")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(1);
  await page.locator("#stable-target").evaluate((node) => {
    const copy = node.cloneNode(true) as Element;
    copy.textContent += "different ending beyond the saved prefix";
    node.after(copy);
  });
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
});

test("does not guess between empty buttons sharing ancestor hints", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await page.evaluate(() => {
    const group = document.createElement("div");
    group.dataset["testid"] = "icon-actions";
    group.innerHTML =
      '<button style="width:40px;height:40px"></button><button style="width:40px;height:40px"></button>';
    document.body.prepend(group);
  });
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.keyboard.press("c");
  await page.locator('[data-testid="icon-actions"] button').first().click({ force: true });
  await page.locator("#browser-review-overlay .composer textarea").fill("Do not guess an icon");
  await page
    .locator("#browser-review-overlay .composer")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await openComments(page);
  await expect(page.locator("#browser-review-overlay .item")).toContainText(
    "multiple matching elements",
  );
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
});

test("tracks the first composer highlight while scrolling before any annotation exists", async ({
  page,
}) => {
  await page.goto(session.reviewUrl);
  await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>("#stable-target")!;
    node.style.position = "fixed";
    node.style.top = "100px";
    document.body.style.minHeight = "3000px";
  });
  await page.keyboard.press("c");
  await page.locator("#stable-target").click({ force: true });
  await expect(page.locator("#browser-review-overlay .composer")).toBeVisible();
  await page.evaluate(() => scrollTo(0, 200));
  await expect
    .poll(async () => {
      const target = await page.locator("#stable-target").boundingBox();
      const highlight = await page.locator("#browser-review-overlay .highlight").boundingBox();
      return Math.abs(target!.y - highlight!.y);
    })
    .toBeLessThan(2);
});

test("removes a pin and explains deletion or ambiguous repeated matches", async ({ page }) => {
  await annotate(page, ".ambiguous-target", "Do not guess between repeats");
  await page.locator(".ambiguous-target").evaluate((target) => {
    target.before(target.cloneNode(true));
  });
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
  await openComments(page);
  await expect(page.locator("#browser-review-overlay .item")).toContainText("Position unconfirmed");

  await page.locator(".ambiguous-target").evaluateAll((targets) => {
    for (const target of targets) target.remove();
  });
  await expect(page.locator("#browser-review-overlay .item")).toContainText("Element not found");
});

test("keeps a different-page comment readable and never scrolls to a replacement", async ({
  page,
}) => {
  await annotate(page, "#stable-target", "Belongs to the original path");
  await page.evaluate(() => {
    history.pushState({}, "", "/different-path");
    const replacement = document.createElement("button");
    replacement.id = "stable-target";
    replacement.textContent = "Stable action";
    document.querySelector("#stable-area")!.replaceChildren(replacement);
  });
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
  await openComments(page);
  const item = page.locator("#browser-review-overlay .item");
  await expect(item).toContainText("Different page");
  await item.click();
  await expect(page.locator("#browser-review-overlay .card")).toContainText("Different page");
});

test("invalidates pins on history-only navigation and restores them on return", async ({
  page,
}) => {
  await annotate(page, "#stable-target", "Original route only");
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(1);
  const original = new URL(page.url()).pathname;
  await page.evaluate(() => history.pushState({}, "", "/history-only"));
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
  await openComments(page);
  await expect(page.locator("#browser-review-overlay .item")).toContainText("Different page");
  await page.evaluate((pathname) => history.replaceState({}, "", pathname), original);
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(1);
});

test("handles invalid or missing anchors and renders hostile text literally", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(session.reviewUrl);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  const hostile = '<img src=x onerror="window.__browserReviewInjected=true">';
  await page.evaluate(
    (comments) => {
      (window as unknown as { __browserReviewInjected: boolean }).__browserReviewInjected = false;
      const url = new URL(location.href);
      const socket = new WebSocket(`${url.origin.replace(/^http/, "ws")}${url.pathname}__br/ws`);
      socket.addEventListener("open", () => {
        for (const annotation of [
          {
            comment: comments.hostile,
            page: { url: location.href, path: location.pathname, title: document.title },
            element: { outerHtmlHead: "<button>", tag: "button" },
            sourceHints: [
              {
                kind: "selector",
                value: "[unterminated",
                text: "No such button",
                bbox: { x: 10, y: 10, width: 10, height: 10 },
                confidence: 0.4,
              },
            ],
          },
          {
            comment: comments.missing,
            page: { url: location.href, path: location.pathname, title: document.title },
            element: { outerHtmlHead: "<aside>", tag: "aside" },
            sourceHints: [],
          },
        ]) {
          socket.send(JSON.stringify({ type: "annotate", annotation }));
        }
      });
    },
    { hostile, missing: "Missing hint remains readable" },
  );

  await openComments(page);
  const panel = page.locator("#browser-review-overlay .panel");
  await expect(panel.locator(".item")).toHaveCount(2);
  await expect(panel).toContainText(hostile);
  await expect(panel).toContainText("Element not found");
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(0);
  await expect(page.locator("#browser-review-overlay img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __browserReviewInjected: boolean }).__browserReviewInjected,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("resynchronizes an open card and preserves reply text, focus, and selection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.defineProperty(window, "__browserReviewSockets", { value: sockets });
    class TrackedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    }
    window.WebSocket = TrackedWebSocket;
  });
  const id = await annotate(page, "#stable-target", "Reconnect this card");
  await fetch(control("ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, question: "Which label should it use?" }),
  });
  const pin = page.locator('#browser-review-overlay .pin[data-asking="true"]');
  await pin.click();
  const area = page.locator("#browser-review-overlay .card textarea");
  await area.fill("Keep this unsent reply");
  await area.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(5, 9);
  });

  await reconnectAround(page, async () => {
    await page
      .locator("#browser-review-overlay .card")
      .getByRole("button", { name: "Reply", exact: true })
      .evaluate((button: HTMLElement) => button.click());
    await expect(area).toHaveValue("Keep this unsent reply");
    await expect(page.locator("#browser-review-overlay .reply-feedback")).toContainText(
      "Disconnected",
    );
    const response = await fetch(control("resolve"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, summary: "Updated while disconnected", filesChanged: [] }),
    });
    expect(response.status).toBe(200);
  });

  expect(errors).toEqual([]);
  const card = page.locator("#browser-review-overlay .card");
  await expect(card).toContainText("resolved");
  await expect(card).toContainText("Unsent reply");
  await expect(area).toHaveValue("Keep this unsent reply");
  expect(
    await area.evaluate((node: HTMLTextAreaElement) => ({
      active: node === node.getRootNode().activeElement,
      start: node.selectionStart,
      end: node.selectionEnd,
    })),
  ).toEqual({ active: true, start: 5, end: 9 });
});

test("coalesces bulk DOM changes and stops work after the page stabilizes", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () {
      reads += 1;
      return original.call(this);
    };
    Object.defineProperty(window, "__geometryReads", {
      get: () => reads,
      set: (value: number) => {
        reads = value;
      },
    });
  });
  await page.goto(session.reviewUrl);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.evaluate(() => {
    const large = document.querySelector("#large-dom")!;
    for (let index = 0; index < 2_000; index += 1) {
      const node = document.createElement(index < 50 ? "button" : "span");
      node.id = `bulk-${index}`;
      node.textContent = `Bulk ${index}`;
      large.append(node);
    }
  });
  await page.waitForTimeout(50);
  expect(await geometryReads(page)).toBe(0);

  await page.evaluate(() => {
    const url = new URL(location.href);
    const socket = new WebSocket(`${url.origin.replace(/^http/, "ws")}${url.pathname}__br/ws`);
    socket.addEventListener("open", () => {
      for (let index = 0; index < 50; index += 1) {
        const target = document.querySelector(`#bulk-${index}`)!;
        const rect = target.getBoundingClientRect();
        socket.send(
          JSON.stringify({
            type: "annotate",
            annotation: {
              comment: `Bulk comment ${index}`,
              page: { url: location.href, path: location.pathname, title: document.title },
              element: { outerHtmlHead: `<button id="bulk-${index}">`, tag: "button" },
              sourceHints: [
                {
                  kind: "selector",
                  value: `#bulk-${index}`,
                  text: `Bulk ${index}`,
                  bbox: {
                    x: rect.left + scrollX,
                    y: rect.top + scrollY,
                    width: rect.width,
                    height: rect.height,
                  },
                  confidence: 0.4,
                },
              ],
            },
          }),
        );
      }
    });
  });
  await expect(page.locator("#browser-review-overlay .pin")).toHaveCount(50);
  await resetGeometryReads(page);
  await page.evaluate(() => {
    const large = document.querySelector("#large-dom")!;
    for (let index = 0; index < 100; index += 1) {
      const node = document.createElement("i");
      node.textContent = String(index);
      large.append(node);
    }
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  // One resolving flush plus ResizeObserver's first geometry-only delivery.
  expect(await geometryReads(page)).toBeLessThanOrEqual(110);

  await resetGeometryReads(page);
  for (let frame = 0; frame < 4; frame += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  }
  expect(await geometryReads(page)).toBe(0);

  await page.locator('#browser-review-overlay [data-action="list"]').click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expect(await geometryReads(page)).toBe(0);
});

async function geometryReads(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __geometryReads: number }).__geometryReads);
}

async function resetGeometryReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __geometryReads: number }).__geometryReads = 0;
  });
}

async function reconnectAround(page: Page, whileDisconnected: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    const sockets = (window as unknown as { __browserReviewSockets: WebSocket[] })
      .__browserReviewSockets;
    sockets.at(-1)?.close();
  });
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute(
    "data-state",
    "closed",
  );
  await expect(page.locator("#browser-review-overlay .card")).toBeVisible();
  await whileDisconnected();
  await expect(page.locator("#browser-review-overlay .card")).toBeVisible();
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open", {
    timeout: 15_000,
  });
}
