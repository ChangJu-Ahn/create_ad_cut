import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// This test is intentionally tolerant: it always captures the landing page
// (proves SWA + ACA are reachable end-to-end) and ADDITIONALLY runs a board
// feature scenario when the /board page exposes the agreed data-testid
// contract. The board PR adds those test ids; the platform PR doesn't —
// same workflow exercises both.

test("platform reachable + board scenario when present", async ({ page }) => {
    // 1) Landing page screenshot — always runs.
    const resp = await page.goto("/", { waitUntil: "networkidle" });
    expect(resp?.ok(), `landing page returned ${resp?.status()}`).toBeTruthy();
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-landing.png"), fullPage: true });

    // 2) Board scenario — only if the page is shipped with data-testid hooks.
    const boardResp = await page.goto("/board", { waitUntil: "networkidle" });
    if (!boardResp?.ok()) {
        test.info().annotations.push({
            type: "skip-reason",
            description: `/board returned ${boardResp?.status()} — skipping board scenario`,
        });
        return;
    }

    const author = page.getByTestId("post-author");
    if (!(await author.isVisible().catch(() => false))) {
        test.info().annotations.push({
            type: "skip-reason",
            description: "data-testid=post-author not found — skipping board scenario",
        });
        return;
    }

    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-board-empty.png"), fullPage: true });

    const stamp = Date.now();
    const content = `e2e post ${stamp}`;

    await author.fill(`tester-${stamp}`);
    await page.getByTestId("post-content").fill(content);
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-board-filled.png"), fullPage: true });

    await page.getByTestId("post-submit").click();

    const list = page.getByTestId("post-list");
    await expect(list).toBeVisible();
    await expect(list.getByText(content)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "04-board-after-submit.png"), fullPage: true });

    // Reload to verify the post was persisted (Read path).
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("post-list").getByText(content)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "05-board-after-reload.png"), fullPage: true });
});
