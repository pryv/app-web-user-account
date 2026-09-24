// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

/**
 * [ATRG] The account tabs registry and src/routes.json (read by the build's
 * SPA fallback) list the same routes, so a tab added in one place only
 * fails here instead of 404ing on a deep link.
 */

vi.mock("pryv", () => ({ default: { Service: class {}, Connection: class {} } }));

import routes from "./routes.json";
import { ACCOUNT_TABS, EXTRA_ROUTES } from "./accountTabs";

describe("[ATRG] account tabs registry vs routes.json", () => {
  it("[ATR1] every account tab is in routes.json account", () => {
    for (const tab of ACCOUNT_TABS) expect(routes.account).toContain(tab.path);
  });

  it("[ATR2] every routes.json account entry is a tab", () => {
    const paths = ACCOUNT_TABS.map((t) => t.path);
    for (const path of routes.account) expect(paths).toContain(path);
  });

  it("[ATR3] every extra route is in routes.json static, without its leading slash", () => {
    for (const r of EXTRA_ROUTES) {
      expect(r.path.startsWith("/")).toBe(true);
      expect(routes.static).toContain(r.path.slice(1));
    }
  });

  it("[ATR4] tab paths are relative and unique", () => {
    const paths = ACCOUNT_TABS.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(false);
  });
});
