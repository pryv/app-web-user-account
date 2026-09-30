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

  // The batch endpoint serves account.get and the delegations.* calls: the
  // pryv client sends every `@pryv/delegation` method as a one-call batch
  // (`connection.apiOne`), so the lists are answered here, by method id.
  const methods: string[] = [];
  await page.route("https://*.example.test/", async (route) => {
    const body = route.request().postDataJSON() as Array<{ method: string }> | null;
    const method = Array.isArray(body) ? body[0]?.method : "";
    methods.push(method);
    const result = (() => {
      switch (method) {
        case "account.get":
          return { account: { username: "alice", email: "a@example.test", language: "en" } };
        case "delegations.listDelegates":
          return { delegates: opts.delegates ?? [] };
        case "delegations.listControlled":
          return { controlled: opts.controlled ?? [] };
        case "delegations.createAccount":
          return {
            delegation: { relId: "rel1", status: "active" },
            apiEndpoint: "https://kid.example.test/",
          };
        default:
          return {};
      }
    })();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, results: [result] }),
    });
  });

  // Seed a session so the account guard does not bounce us to /signin.
  await page.addInitScript(() => {
    // Exact keys from src/lib/session.tsx — a near-miss here renders nothing
    // and every assertion below fails for the wrong reason.
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });

  /** Batch method ids the page sent, in order. */
  return { methods };
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

  test("[DLG1] leads with creation: Create, Accounts I manage, My delegates", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");
    const sections = page.getByRole("heading", { level: 2 });
    await expect(sections).toHaveText(["Create a managed account", "Accounts I manage", "My delegates"]);
    // The lists loaded (empty), and no load error sits above the sections.
    await expect(page.getByText("You do not manage any accounts.")).toBeVisible();
    await expect(page.getByText("No delegates.")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("[DLG2] ?create=1 focuses the creation form", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation?create=1");
    await expect(page.locator("#managed-username")).toBeFocused();
  });

  test("[DLG3] #create focuses the creation form too", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation#create");
    await expect(page.locator("#managed-username")).toBeFocused();
  });

  test("[DLG4] after a creation, a way on to the app that sent the user", async ({ page }) => {
    const { methods } = await signedInWithDelegation(page, {});
    await page.goto(
      "/account/delegation?backUrl=" + encodeURIComponent("https://app.example.test/") + "&backLabel=App",
    );
    // Not offered before a creation.
    await expect(page.getByRole("heading", { name: "Create a managed account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to App" })).toHaveCount(0);

    await page.locator("#managed-username").fill("kid-one");
    await page.getByRole("button", { name: "Create managed account" }).click();

    const notice = page.getByRole("alert").filter({ hasText: "Account kid-one created" });
    await expect(notice).toBeVisible();
    const link = notice.getByRole("link", { name: "Continue to App" });
    await expect(link).toHaveAttribute("href", "https://app.example.test/");
    // The host is shown next to the label (anti-phishing cue).
    await expect(notice).toContainText("(app.example.test)");
    expect(methods).toContain("delegations.createAccount");
  });

  test("[DLG5] a signed-out visit keeps ?create=1 through the sign-in bounce", async ({ page }) => {
    await page.goto("/account/delegation?create=1");
    await expect(page).toHaveURL(/\/signin\?.*returnTo=[^&]*create%3D1/);
  });
});
