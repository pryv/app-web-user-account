import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke E2E config — boots the Vite dev server and runs Chromium against it.
 *
 * Tests that need network are written to MOCK the Pryv endpoints with
 * `page.route(...)` so the suite is hermetic + fast + offline-runnable.
 * Tests that exercise the missing-param / required-field UI need no
 * network at all.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
