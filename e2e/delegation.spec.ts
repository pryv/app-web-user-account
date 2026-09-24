import { test, expect } from "@playwright/test";

/**
 * Account delegation, hermetic.
 *
 * The one that matters most is the banner. A delegate token is
 * owner-equivalent and `user.username` IS the controlled account, so if
 * `DelegatedSessionBanner` ever stops rendering, nothing else on any screen
 * tells someone they are editing a relative's account rather than their own.
 * That regression would be invisible to every other test in this suite, and to
 * a human clicking through as themselves.
 *
 * The full-control warning is checked for substance, not wording: it must say a
 * delegate can log in directly and remove other delegates, and must NOT claim
 * that is impossible (an earlier copy did, so this guards against regressing to
 * a comfortable lie).
 */

/**
 * Every mocked core response MUST carry `meta`. The pryv client validates it
 * and throws "Cannot find .meta in response" otherwise, which surfaces as a
 * silently missing banner rather than an obvious failure, because the banner
 * treats an unreadable access-info as "not a delegated session". Do not drop
 * it from a new mock.
 */
const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
  features: { emailVerification: { atRegistration: false, onAccount: true } },
};

/** A signed-in session plus the delegation lists, with no platform behind them. */
async function signedInWithDelegation(
  page: import("@playwright/test").Page,
  opts: {
    delegates?: unknown[];
    controlled?: unknown[];
    /** When set, access-info reports a DELEGATED session. */
    actingAs?: { controlled: string; delegate: string };
  } = {},
) {
  await page.route("**/service/info", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SERVICE_INFO) }),
  );

  const accessInfo: Record<string, unknown> = {
    type: "personal",
    user: { username: opts.actingAs?.controlled ?? "alice" },
  };
  if (opts.actingAs) {
    accessInfo.delegation = {
      isDelegatedAccess: true,
      controlledUsername: opts.actingAs.controlled,
      delegate: { username: opts.actingAs.delegate, hostSlug: "example-test" },
    };
  }
  await page.route("**/access-info**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, ...accessInfo }),
    }),
  );

  // The batch endpoint serves account.get and the delegations.* calls.
  await page.route("https://*.example.test/", async (route) => {
    const body = route.request().postDataJSON() as Array<{ method: string }> | null;
    const method = Array.isArray(body) ? body[0]?.method : "";
    if (method === "account.get") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          meta: META,
          results: [{ account: { username: "alice", email: "a@example.test", language: "en" } }],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, results: [{}] }),
    });
  });

  await page.route("**/delegations/delegates**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, delegates: opts.delegates ?? [] }),
    }),
  );
  await page.route("**/delegations/controlled**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, controlled: opts.controlled ?? [] }),
    }),
  );

  // Seed a session so the account guard does not bounce us to /signin.
  await page.addInitScript(() => {
    // Exact keys from src/lib/session.tsx — a near-miss here renders nothing
    // and every assertion below fails for the wrong reason.
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });
}

test.describe("delegated-session banner", () => {
  test("renders on an account route when access-info marks the session delegated", async ({ page }) => {
    await signedInWithDelegation(page, { actingAs: { controlled: "kid", delegate: "parent" } });
    await page.goto("/account/profile");
    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("kid");
    await expect(banner).toContainText("parent");
  });

  test("renders outside the account section too", async ({ page }) => {
    await signedInWithDelegation(page, { actingAs: { controlled: "kid", delegate: "parent" } });
    await page.goto("/change-password");
    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("kid");
  });

  test("is ABSENT on an ordinary personal session", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/profile");
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    await expect(page.getByTestId("delegated-session-banner")).toHaveCount(0);
  });
});

test.describe("/account/delegation", () => {
  test("shows the three sections and the full-control warning", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");

    await expect(page.getByRole("heading", { name: "My delegates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Accounts I manage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a managed account" })).toBeVisible();

    // Substance of the warning, not its exact wording.
    const warning = page.getByText("A delegate has full control of this account:");
    await expect(warning).toBeVisible();
    const body = page.locator("ul", { hasText: "read and change everything" });
    await expect(body).toContainText("log in to the account directly");
    await expect(body).toContainText("remove other delegates");
    await expect(body).toContainText("audit trail");
    // It must never claim co-delegate eviction is impossible.
    await expect(body).not.toContainText("impossible");
  });

  test("invites are rejected before the network when the username is invalid", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");
    await page.getByLabel("Delegate username").fill("x");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid username" })).toBeVisible();
  });
});
