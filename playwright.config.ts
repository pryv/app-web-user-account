import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke E2E config — boots the Vite dev server and runs Chromium against it.
 *
 * Tests that need network are written to MOCK the Pryv endpoints with
 * `page.route(...)` so the suite is hermetic + fast + offline-runnable.
 * Tests that exercise the missing-param / required-field UI need no
 * network at all.
 *
 * `E2E_PORT` (default 5173) moves the dev server, so several checkouts can
 * run the suite at once: give each its own port. A server already listening
 * on the port is reused (outside CI), so two checkouts sharing a port would
 * test each other's tree. The dev server is started with `--strictPort`, so
 * it fails instead of silently moving to another port.
 */
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // The specs assert English copy: pin the browser language.
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
