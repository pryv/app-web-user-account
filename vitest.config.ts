import { defineConfig } from "vitest/config";

/**
 * Vitest config — only picks up `src/**` unit tests. The `e2e/` directory is
 * Playwright's territory (run via `npm run e2e`) so we exclude it here.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e"],
    setupFiles: ["src/test/setup.ts"],
    // Route tests render whole pages in jsdom, and a CPU-starved run (sibling
    // builds, background priority) stretches them far past their usual second:
    // at 15 s some failed at random. 60 s still catches a hang.
    testTimeout: 60000,
    hookTimeout: 60000,
    // One jsdom fork per core starved itself on a busy machine (workers that
    // never answered, pages past every budget); four stay green there. On a
    // quiet machine `npx vitest run --maxWorkers=100%` is faster.
    maxWorkers: 4,
  },
});
