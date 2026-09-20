// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { expect, test } from "@playwright/test";
const CLI = path.resolve("packages/browser-review/dist/cli.js");
let dir: string;
let session: { sessionId: string; reviewUrl: string };
let upstream: http.Server;
let upstreamPort: number;
function cli(...args: string[]) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: path.join(dir, "state") },
  });
}
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-adversarial-"));
  const html = await fs.readFile("e2e/fixtures/adversarial.html", "utf8");
  upstream = http.createServer((req, res) => {
    if (req.url === "/entry.js" || req.url === "/dependency.js") {
      res.setHeader("content-type", "text/javascript");
      return res.end(
        req.url === "/entry.js"
          ? 'import {message} from "/dependency.js"; document.querySelector("#module-status").textContent = message;'
          : 'export const message = "Root module imports loaded";',
      );
    }
    res.setHeader("content-type", "text/html");
    res.end(html.replace("</body>", '<script type="module" src="/entry.js"></script></body>'));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = (upstream.address() as { port: number }).port;
});
test.beforeEach(() => {
  session = JSON.parse(cli("open", `http://127.0.0.1:${upstreamPort}`, "--json"));
});
test.afterEach(() => {
  cli("close", "--session", session.sessionId);
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});
async function annotations() {
  return (await (await fetch(`${session.reviewUrl}__br/annotations`)).json()).annotations as Array<{
    comment: string;
    element: unknown;
    sourceHints: Array<{ kind: string; value: string }>;
  }>;
}
test("root module imports load, duplicate attributes identify the clicked element, private text stays private", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(session.reviewUrl);
  await expect(page.locator("#module-status")).toHaveText("Root module imports loaded");
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("button", { name: "2番目のボタン", exact: true }).click();
  await page.getByPlaceholder("What should change here?").fill("Second button only");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await annotations()).length).toBe(1);
  const selector = (await annotations())[0]!.sourceHints.find((h) => h.kind === "selector")!.value;
  await expect(page.locator(selector)).toHaveCount(1);
  await expect(page.locator(selector)).toHaveText("2番目のボタン");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.locator(".private-fields").click({ position: { x: 5, y: 5 } });
  await page.getByPlaceholder("What should change here?").fill("Private fields layout");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(async () => (await annotations()).length).toBe(2);
  expect(JSON.stringify(await annotations())).not.toContain("fixture-");
  expect(errors).toEqual([]);
});
test("keeps an unsent comment when the socket disconnects", async ({ page }) => {
  await page.goto(session.reviewUrl);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute("data-state", "open");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("button", { name: "2番目のボタン", exact: true }).click();
  await page.getByPlaceholder("What should change here?").fill("Keep this draft");
  cli("close", "--session", session.sessionId);
  await expect(page.locator("#browser-review-overlay .dot")).toHaveAttribute(
    "data-state",
    "closed",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByPlaceholder("What should change here?")).toHaveValue("Keep this draft");
  await expect(page.getByText("Disconnected. Wait for reconnection, then retry.")).toBeVisible();
});
