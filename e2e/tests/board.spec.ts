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
    // Allow retries below to exceed the default 60s budget.
    test.setTimeout(180_000);

    // Surface SPA console errors so a blank white screen fails the test
    // instead of passing on a 200 HTML response.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // 1) Landing page — must render the app shell, not just return 200.
    // SWA staging can serve a stale index.html that references bundle hashes
    // not yet uploaded for ~30-60s after deploy-frontend completes. Retry
    // until the shell mounts or budget runs out.
    const brand = page.getByRole("link", { name: /create-ad-cut/i });
    let landed = false;
    let lastErrors: string[] = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
        consoleErrors.length = 0;
        const resp = await page.goto("/", { waitUntil: "networkidle" });
        if (resp?.ok()) {
            const visible = await brand.isVisible({ timeout: 5_000 }).catch(() => false);
            if (visible) {
                landed = true;
                break;
            }
        }
        lastErrors = [...consoleErrors];
        console.log(`landing attempt ${attempt} failed (${lastErrors.length} console errors), retrying in 15s`);
        await page.waitForTimeout(15_000);
    }
    expect(
        landed,
        `app shell did not render after 6 attempts. last console errors: ${lastErrors.join(" | ") || "(none)"}`
    ).toBeTruthy();

    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-landing.png"), fullPage: true });

    // 1b) Click the header board button to verify discoverability — only if
    // data-testid=nav-board is present (added alongside the board feature).
    const navBoard = page.getByTestId("nav-board");
    if (await navBoard.isVisible().catch(() => false)) {
        await navBoard.click();
        await page.waitForURL(/\/board$/, { timeout: 5_000 }).catch(() => undefined);
        await page.screenshot({ path: join(SCREENSHOT_DIR, "01b-board-from-nav.png"), fullPage: true });
    }

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
