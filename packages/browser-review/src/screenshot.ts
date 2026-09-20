// SPDX-License-Identifier: Apache-2.0
import type { Session } from "@browser-review/shared";
import { reviewUrl } from "./format.js";

/**
 * Minimal shape of the bits of Playwright this uses, so the package stays an
 * optional extra rather than a dependency everyone pays for.
 */
interface PlaywrightLike {
  chromium: {
    launch(options?: { headless?: boolean }): Promise<{
      newPage(): Promise<{
        goto(url: string, options?: { waitUntil?: "load" | "networkidle" }): Promise<unknown>;
        screenshot(options?: { type?: "png" }): Promise<Buffer>;
        locator(selector: string): { screenshot(options?: { type?: "png" }): Promise<Buffer> };
      }>;
      close(): Promise<void>;
    }>;
  };
}

/**
 * Build a screenshot function, or return undefined when Playwright is not
 * installed.
 *
 * Screenshots are the one thing here that needs a browser engine, and a 100 MB
 * download is not a reasonable price for a tool whose whole job can be done
 * without it. So the capability is probed at startup and `review_screenshot`
 * answers `not_supported` when it is missing.
 */
export async function createScreenshotter(
  session: Session,
): Promise<((selector?: string) => Promise<{ base64: string; mimeType: string }>) | undefined> {
  let playwright: PlaywrightLike;
  try {
    playwright = (await import("playwright")) as unknown as PlaywrightLike;
  } catch {
    return undefined;
  }
  if (typeof playwright?.chromium?.launch !== "function") return undefined;

  return async (selector?: string) => {
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(reviewUrl(session), { waitUntil: "load" });
      const png = selector
        ? await page.locator(selector).screenshot({ type: "png" })
        : await page.screenshot({ type: "png" });
      return { base64: png.toString("base64"), mimeType: "image/png" };
    } finally {
      await browser.close();
    }
  };
}
