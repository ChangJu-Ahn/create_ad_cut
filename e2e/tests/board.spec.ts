import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_DIR = join(process.cwd(), "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Always capture the landing page (proves SWA + ACA wiring) and ADDITIONALLY
// drive the read-only gallery (/gallery) when its hooks are present.
//
// The gallery is purely a read view backed by GET /api/sessions. To prove
// persistence end-to-end we first POST a new session against the same
// backend the SWA bundle was built against, then visit /gallery and assert
// that session id is rendered.

test("platform reachable + gallery shows persisted sessions", async ({ page, request }) => {
    test.setTimeout(180_000);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // 1) Landing — retry to ride out SWA bundle propagation lag.
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
        console.log(`landing attempt ${attempt} failed, retrying in 15s`);
        await page.waitForTimeout(15_000);
    }
    expect(
        landed,
        `app shell did not render after 6 attempts. last console errors: ${lastErrors.join(" | ") || "(none)"}`
    ).toBeTruthy();
    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-landing.png"), fullPage: true });

    // 2) Skip the gallery scenario unless the page is shipped.
    const navGallery = page.getByTestId("nav-gallery");
    if (!(await navGallery.isVisible().catch(() => false))) {
        test.info().annotations.push({
            type: "skip-reason",
            description: "data-testid=nav-gallery not present — gallery feature not shipped on this branch",
        });
        return;
    }

    // 3) Seed a session against the per-PR ACA backend so the gallery has
    // at least one card to show. BACKEND_URL is the bare ACA host; the
    // backend mounts every route under /api.
    const backend = process.env.BACKEND_URL;
    if (!backend || backend === "(none)") {
        test.info().annotations.push({
            type: "skip-reason",
            description: "BACKEND_URL not set — cannot seed gallery",
        });
        return;
    }
    const create = await request.post(`${backend.replace(/\/$/, "")}/api/sessions`);
    expect(create.ok(), `seed POST /api/sessions failed: ${create.status()}`).toBeTruthy();
    const created = await create.json();
    const seededId = (created.sessionId as string) ?? "";
    expect(seededId).toMatch(/^[a-f0-9]{8,}$/);
    const seededShort = seededId.slice(0, 8);

    // 4) Enter the gallery via the header button — proves discoverability.
    await navGallery.click();
    await page.waitForURL(/\/gallery$/, { timeout: 5_000 }).catch(() => undefined);

    // The gallery may take a few moments to fetch /api/sessions; wait for
    // either at least one card or the seeded id to appear.
    const list = page.getByTestId("gallery-list");
    await expect(list).toBeVisible();
    await expect(list.getByText(seededShort)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-gallery.png"), fullPage: true });

    // 5) Reload — verifies the gallery still reads the same Cosmos state
    // (no client-side cache, no input form).
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("gallery-list").getByText(seededShort)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-gallery-after-reload.png"), fullPage: true });
});
