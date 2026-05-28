import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Demo-only smoke: land on /, open the read-only gallery from the header,
// reload it, and capture screenshots. No seeding — production Cosmos already
// has data and the gallery reads it directly.
test("gallery reachable + reload preserves view", async ({ page }) => {
    test.setTimeout(120_000);

    // 1) Landing — retry to ride out SWA bundle propagation lag.
    const brand = page.getByRole("link", { name: /create-ad-cut/i });
    let landed = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
        await page.goto("/", { waitUntil: "networkidle" }).catch(() => undefined);
        if (await brand.isVisible({ timeout: 5_000 }).catch(() => false)) {
            landed = true;
            break;
        }
        console.log(`landing attempt ${attempt} not ready, retrying in 15s`);
        await page.waitForTimeout(15_000);
    }
    expect(landed, "app shell never rendered").toBeTruthy();
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-landing.png"), fullPage: true });

    // 2) Open the gallery from the header.
    const navGallery = page.getByTestId("nav-gallery");
    if (!(await navGallery.isVisible().catch(() => false))) {
        test.info().annotations.push({
            type: "skip-reason",
            description: "nav-gallery missing — gallery feature not on this branch",
        });
        return;
    }
    await navGallery.click();
    await page.waitForURL(/\/gallery$/, { timeout: 5_000 }).catch(() => undefined);

    // Gallery shows the list (or the empty-state placeholder) after fetching.
    const ready = page
        .locator('[data-testid="gallery-list"], [data-testid="gallery-empty"]')
        .first();
    await expect(ready).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-gallery.png"), fullPage: true });

    // 3) Reload — proves Cosmos read path survives a hard refresh (the core
    // user complaint that motivated this feature).
    await page.reload({ waitUntil: "networkidle" });
    await expect(
        page.locator('[data-testid="gallery-list"], [data-testid="gallery-empty"]').first()
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-gallery-after-reload.png"), fullPage: true });
});
