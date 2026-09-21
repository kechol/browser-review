// SPDX-License-Identifier: Apache-2.0
//
// The unit tests cover the server's side of a review. This covers the half that
// only a real browser can: whether a person can point at something on the page
// and have the comment come out the other end attached to the right line.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "browser-review", "dist", "cli.js");

interface OpenResult {
  sessionId: string;
  token: string;
  reviewUrl: string;
  port: number;
}

let stateHome: string;
let pageDir: string;
let session: OpenResult;

function cli(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
}

test.beforeAll(async () => {
  stateHome = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-e2e-state-"));
  pageDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-e2e-page-"));
  await fs.copyFile(
    path.join(ROOT, "examples", "static", "page.html"),
    path.join(pageDir, "page.html"),
  );
  await fs.copyFile(
    path.join(ROOT, "examples", "static", "styles.css"),
    path.join(pageDir, "styles.css"),
  );
  session = JSON.parse(
    cli("open", path.join(pageDir, "page.html"), "--project-dir", pageDir, "--json"),
  ) as OpenResult;
});

test.afterAll(async () => {
  try {
    cli("close", "--session", session.sessionId);
  } catch {
    // Already gone.
  }
  await fs.rm(stateHome, { recursive: true, force: true });
  await fs.rm(pageDir, { recursive: true, force: true });
});

function control(route: string): string {
  return `http://127.0.0.1:${session.port}/r/${session.token}/__br/${route}`;
}

async function pending(): Promise<
  Array<{ id: string; comment: string; sourceHints: Array<Record<string, unknown>> }>
> {
  const res = await fetch(control("pending"));
  const body = (await res.json()) as { annotations: never[] };
  return body.annotations;
}

/** Turn on annotation mode and click an element, which opens the composer. */
async function annotate(page: Page, selector: string, comment: string): Promise<void> {
  await page.locator('#browser-review-overlay .toolbar button[data-action="annotate"]').click();
  await page.locator(selector).click({ force: true });
  const composer = page.locator("#browser-review-overlay .composer");
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
  await composer.locator("button", { hasText: "Send" }).click();
  await expect(composer).toBeHidden();
}

test("the overlay loads and connects", async ({ page }) => {
  await page.goto(session.reviewUrl);
  const toolbar = page.locator("#browser-review-overlay .toolbar");
  await expect(toolbar).toBeVisible();
  const dot = page.locator("#browser-review-overlay .dot");
  await expect(dot).toHaveAttribute("data-state", "open");
  await expect(dot).toHaveAttribute("title", "Connected to the review server");
  await expect(dot).toHaveAccessibleName("Connected to the review server");
});

test("a comment on the headline arrives with the source line attached", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await annotate(page, "h1.hero-title", "This headline is too small above the fold.");

  await expect.poll(async () => (await pending()).length).toBe(1);
  const [annotation] = await pending();
  expect(annotation!.comment).toBe("This headline is too small above the fold.");

  const top = annotation!.sourceHints[0]!;
  expect(top["kind"]).toBe("loc");
  expect(top["file"]).toBe("page.html");
  // The h1 sits on line 21 of examples/static/page.html.
  expect(top["line"]).toBe(21);
  expect(top["via"]).toBe("data-review-src");
});

test("a pin appears, and turns green when an agent resolves it", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await annotate(page, "h1.hero-title", "Independent resolution test");
  await expect
    .poll(async () => (await pending()).some((a) => a.comment === "Independent resolution test"))
    .toBe(true);
  const annotation = (await pending()).find((a) => a.comment === "Independent resolution test")!;
  const pin = page.locator("#browser-review-overlay .pin").last();
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute("data-status", /pending|acknowledged/);

  const res = await fetch(control("resolve"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: annotation!.id,
      summary: "Raised the hero title to 44px.",
      filesChanged: ["page.html"],
    }),
  });
  expect(res.status).toBe(200);

  await expect(pin).toHaveAttribute("data-status", "resolved");
  await expect(pin).toHaveAttribute("title", "Raised the hero title to 44px.");
  await page.keyboard.press("l");
  const swatch = page
    .locator("#browser-review-overlay .panel .item")
    .filter({ hasText: "Independent resolution test" })
    .locator(".swatch");
  await expect(swatch).toHaveAttribute("title", "Resolved — changes completed");
  await expect(swatch).toHaveAccessibleName("Resolved — changes completed");
});

test("an agent's question reaches the reviewer, and the reply goes back", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await annotate(page, "button.cta", "This button should say Get started.");
  await expect.poll(async () => (await pending()).length).toBeGreaterThan(0);
  const target = (await pending()).at(-1)!;

  await fetch(control("ask"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: target.id, question: "Do you mean the hero button?" }),
  });

  const asking = page.locator('#browser-review-overlay .pin[data-asking="true"]');
  await expect(asking).toBeVisible();
  await asking.click();

  const card = page.locator("#browser-review-overlay .card");
  await expect(card.locator(".question")).toContainText("Do you mean the hero button?");
  await card.locator("textarea").fill("Yes, the hero one.");
  await card.locator("button", { hasText: "Reply" }).click();

  await expect
    .poll(async () => {
      const res = await fetch(control("annotations"));
      const body = (await res.json()) as {
        annotations: Array<{ id: string; questions: Array<{ from: string; text: string }> }>;
      };
      return body.annotations.find((a) => a.id === target.id)?.questions.map((q) => q.text);
    })
    .toContain("Yes, the hero one.");
});

test("the page reloads itself when the file under review changes", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await expect(page.locator("h1.hero-title")).toContainText("Keep track");

  const file = path.join(pageDir, "page.html");
  const html = await fs.readFile(file, "utf8");
  await fs.writeFile(file, html.replace("Keep track of everything", "Catch everything"));

  await expect(page.locator("h1.hero-title")).toContainText("Catch everything", {
    timeout: 10_000,
  });
});

test("keyboard shortcuts open selection, comments, and live status", async ({ page }) => {
  await page.goto(session.reviewUrl);
  const overlay = page.locator("#browser-review-overlay");
  await expect(overlay.locator(".dot")).toHaveAttribute("data-state", "open");
  await page.keyboard.press("c");
  await expect(overlay.locator('[data-action="annotate"]')).toHaveAttribute("data-on", "true");
  await page.keyboard.press("Escape");
  await expect(overlay.locator('[data-action="annotate"]')).toHaveAttribute("data-on", "false");
  await page.keyboard.press("l");
  await expect(overlay.getByRole("region", { name: "Comments", exact: true })).toBeVisible();
  await page.keyboard.press("s");
  await expect(overlay.getByRole("region", { name: "Comments", exact: true })).toBeHidden();
  const status = overlay.getByRole("region", { name: "Review status" });
  await expect(status).toContainText("Connected");
  await expect(status).toContainText(control("mcp"));
  await expect(status).toContainText("html-file");
  await page.keyboard.press("s");
  await expect(status).toBeHidden();
  await overlay.locator('[data-action="status"]').click();
  await expect(status).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(status).toBeHidden();
});

test("shortcuts ignore typing, modifiers, composition, and repeated keys", async ({ page }) => {
  await page.goto(session.reviewUrl);
  const overlay = page.locator("#browser-review-overlay");
  await expect(overlay.locator(".toolbar")).toBeVisible();
  await page.evaluate(() => {
    for (const tag of ["input", "textarea", "select", "div"]) {
      const node = document.createElement(tag);
      if (tag === "div") node.contentEditable = "true";
      document.body.append(node);
      node.focus();
      for (const key of ["c", "l", "s"]) {
        node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
      }
      node.remove();
    }
    for (const option of ["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing"]) {
      for (const key of ["c", "l", "s"]) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key, [option]: true }));
      }
    }
  });
  await expect(overlay.locator(".panel")).toBeHidden();
  await expect(overlay.locator('[data-action="annotate"]')).not.toHaveAttribute("data-on", "true");
  await page.keyboard.press("c");
  await page.locator("h1.hero-title").click({ force: true });
  const area = overlay.locator(".composer textarea");
  await area.pressSequentially("cls");
  await expect(area).toHaveValue("cls");
  await expect(overlay.locator(".panel")).toBeHidden();
  await expect(overlay.locator('[data-action="annotate"]')).toHaveAttribute("data-on", "false");
});

test("comment list preserves full multiline text without horizontal overflow", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  const comment = "長文のコメント\n\n" + "改行を保持してください。\n".repeat(30) + "x".repeat(500);
  await annotate(page, "h1.hero-title", comment);
  await page.keyboard.press("l");
  const panel = page.locator("#browser-review-overlay .panel");
  const text = panel.locator(".text").filter({ hasText: "長文のコメント" });
  await expect(text).toHaveText(comment);
  await expect(text).toHaveCSS("white-space", "pre-wrap");
  await expect(text).toHaveCSS("-webkit-line-clamp", "none");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await panel.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  }
});

test("clicking a comment scrolls to its element and keeps the detail card in view", async ({
  page,
}) => {
  await page.goto(session.reviewUrl);
  const overlay = page.locator("#browser-review-overlay");
  await expect(overlay.locator(".dot")).toHaveAttribute("data-state", "open");
  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
  });
  const comment = "Scroll back to this headline";
  await annotate(page, "h1.hero-title", comment);
  await page.evaluate(() => window.scrollTo(0, 2500));
  const target = page.locator("h1.hero-title");
  await expect(target).not.toBeInViewport();
  await page.keyboard.press("l");
  await overlay.locator(".panel .item").filter({ hasText: comment }).click();
  await expect(target).toBeInViewport();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(overlay.locator(".card")).toBeInViewport();
  await expect(overlay.locator(".card .comment")).toHaveText(comment);

  // A removed target must still allow reading the comment.
  await target.evaluate((node) => node.remove());
  await overlay.locator(".card").getByRole("button", { name: "Close" }).click();
  await overlay.locator(".panel .item").filter({ hasText: comment }).click();
  await expect(overlay.locator(".card .comment")).toHaveText(comment);
});
