import { defineConfig } from "@playwright/test";

// FRONTEND_URL is required (SWA staging URL for this PR).
// BACKEND_URL is reported alongside but Playwright drives the SWA UI directly.
const frontendUrl = process.env.FRONTEND_URL;
if (!frontendUrl) {
    throw new Error("FRONTEND_URL is required");
}

export default defineConfig({
    testDir: "./tests",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    retries: 0,
    reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
    outputDir: "test-results",
    use: {
        baseURL: frontendUrl,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        ignoreHTTPSErrors: true,
    },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
    ],
});
