import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Account section layout, hermetic, over the wire.
 *
 * At 1280 px the account nav is a vertical list beside the page; at 390 px it
 * is one row that scrolls sideways, and no account page scrolls sideways
 * (profile, security, connected apps, Audit trail, an access page).
 */

const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
};

const ACCESSES = [
  { id: "self-1", name: "account-app", type: "personal", created: 1789000000, lastUsed: 1789500000 },
  {
    id: "g1:2",
    name: "oauth-grant:clinic-with-a-rather-long-client-identifier",
    type: "app",
    created: 1789000000,
    permissions: [{ streamId: "diary", level: "read" }],
    clientData: {
      oauth: { client: { name: "Clinic app", host: "clinic.example.test", url: "https://clinic.example.test/client-metadata.json" } },
      cmc: { counterparty: { username: "carol", apiEndpoint: "https://grant-token@carol.example.test/" } },
    },
  },
  { id: "app-1", name: "diary-app", type: "app", created: 1789000000, permissions: [] },
];

const AUDIT = [
  {
    id: "a1",
    time: 1789500000,
    type: "audit-log/pryv-api",
    streamIds: [":_audit:access-app-1", ":_audit:action-events.get"],
    content: { source: { ip: "203.0.113.10" }, query: { streams: ["diary", "a-stream-with-a-long-identifier-to-stretch-the-row"] } },
  },
  {
    id: "a2",
    time: 1789400000,
    type: "audit-log/pryv-api-error",
    streamIds: [":_audit:access-g1", ":_audit:action-events.create"],
    content: { source: { ip: "203.0.113.11" }, id: "forbidden", message: "the access cannot write to stream diary-and-more-text" },
  },
];

interface CoreCall {
  method: string;
  params: Record<string, unknown>;
}

function json(route: import("@playwright/test").Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockPlatform(context: BrowserContext): Promise<void> {
  // Anything this spec did not mock is refused instead of reaching the network.
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await context.route("**/settings.json", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/service/info", (route) => json(route, SERVICE_INFO));
  await context.route("https://alice.example.test/access-info", (route) =>
    json(route, { meta: META, id: "self-1", type: "personal", user: { username: "alice" } }),
  );
  await context.route("https://alice.example.test/", (route) => {
    const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
    const results = calls.map((c) => {
      switch (c.method) {
        case "account.get":
          return { account: { username: "alice", email: "alice@example.test", language: "en" } };
        case "accesses.get":
          return { accesses: ACCESSES, accessDeletions: [] };
        case "streams.get":
          return { streams: [{ id: ":_audit:action-events.get" }, { id: ":_audit:action-events.create" }] };
        case "events.get":
          return { events: c.params.streams ? AUDIT : [] };
        default:
          return { error: { id: "unknown-resource", message: `unmocked ${c.method}` } };
      }
    });
    return json(route, { meta: META, results });
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });
}

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test.describe("[E2E] account layout", () => {
  test("[E2E1] at 1280 px the nav is a vertical list beside the page", async ({ page, context }) => {
    await mockPlatform(context);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/account/profile");
    const nav = page.getByRole("navigation", { name: "Account sections" });
    await expect(nav.getByRole("link", { name: "Audit trail" })).toBeVisible();
    await expect(page.getByText("alice", { exact: true })).toBeVisible();

    const links = nav.getByRole("link");
    const first = (await links.nth(0).boundingBox())!;
    const second = (await links.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y);
    expect(Math.abs(second.x - first.x)).toBeLessThan(2);

    const navBox = (await nav.boundingBox())!;
    const content = (await page.getByTestId("account-content").boundingBox())!;
    expect(content.x).toBeGreaterThanOrEqual(navBox.x + navBox.width);
    expect(content.y).toBeLessThan(navBox.y + navBox.height);
    expect(await pageScrollsSideways(page)).toBe(false);
  });

  test("[E2E2] at 390 px the tabs scroll sideways and no account page does", async ({ page, context }) => {
    await mockPlatform(context);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/account/profile");
    const nav = page.getByRole("navigation", { name: "Account sections" });
    await expect(page.getByText("alice", { exact: true })).toBeVisible();
    const links = nav.getByRole("link");
    const first = (await links.nth(0).boundingBox())!;
    const second = (await links.nth(1).boundingBox())!;
    expect(Math.abs(second.y - first.y)).toBeLessThan(2);
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await pageScrollsSideways(page)).toBe(false);

    for (const [path, ready] of [
      ["/account/security", page.getByText("account-app", { exact: true })],
      ["/account/apps", page.getByText("Clinic app", { exact: true }).first()],
      ["/account/audit", page.getByRole("cell", { name: "events.get" })],
      ["/account/audit-access/g1%3A2", page.getByRole("heading", { name: "Activity" })],
    ] as const) {
      await page.goto(path);
      await expect(ready).toBeVisible();
      expect({ path, sideways: await pageScrollsSideways(page) }).toEqual({ path, sideways: false });
    }
  });
});
