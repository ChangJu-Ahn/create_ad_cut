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
    // Surface SPA console errors so a blank white screen fails the test
    // instead of passing on a 200 HTML response.
    const consoleErrors: string[] = [];
    const backendApiRequests: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("request", (req) => {
        const url = req.url();
        if (url.includes("azurecontainerapps.io")) {
            backendApiRequests.push(url);
        }
    });

    // 1) Landing page — must render the app shell, not just return 200.
    const resp = await page.goto("/", { waitUntil: "networkidle" });
    expect(resp?.ok(), `landing page returned ${resp?.status()}`).toBeTruthy();

    // The React app always renders the brand link in the top bar. If this
    // is not visible, the SPA failed to mount (blank white screen).
    await expect(
        page.getByRole("link", { name: /create-ad-cut/i }),
        `app shell did not render. console errors: ${consoleErrors.join(" | ") || "(none)"}`
    ).toBeVisible({ timeout: 10_000 });

    // Regression guard: preview frontend must call backend with /api prefix.
    expect
        .soft(
            backendApiRequests.every((url) => url.includes("/api/")),
            `backend calls missing /api prefix: ${backendApiRequests.join(" | ") || "(none)"}`
        )
        .toBeTruthy();

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
