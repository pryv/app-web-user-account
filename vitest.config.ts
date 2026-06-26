import { defineConfig } from "vitest/config";

/**
 * Vitest config — only picks up `src/**` unit tests. The `e2e/` directory is
 * Playwright's territory (run via `npm run e2e`) so we exclude it here.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});
