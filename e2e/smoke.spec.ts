import { test, expect } from "@playwright/test";

const SVC = "https://reg.example.test/service/info";

/**
 * Public-route render — no auth, no network. Each page should mount, show
 * its heading, and (when applicable) render an inline alert for missing
 * required-context params instead of crashing.
 */
test.describe("smoke — public routes render", () => {
  test("/signin shows the sign-in form", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Username or email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("/register shows the create-account form", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
  });

  test("/reset-password shows the request form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  });

  test("/mfa-challenge without userId/mfaToken shows an explanatory alert", async ({ page }) => {
    await page.goto("/mfa-challenge");
    await expect(page.getByRole("alert")).toContainText("missing or expired");
    await expect(page.getByRole("button", { name: "Verify" })).toBeDisabled();
  });

  test("/cmc-accept without capabilityUrl shows an explanatory alert", async ({ page }) => {
    await page.goto("/cmc-accept");
    await expect(page.getByRole("alert")).toContainText("missing its request reference");
  });
});

test.describe("smoke — new routes (consent-track placeholders + scope-update + reset-token mode)", () => {
  test("/auth shows the pending-consent-track placeholder (route exists, UI gap visible)", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Authorize access" })).toBeVisible();
  });

  test("/oauth2-authorize shows the pending-consent-track placeholder", async ({ page }) => {
    await page.goto("/oauth2-authorize");
    await expect(page.getByRole("heading", { name: "OAuth2 authorize" })).toBeVisible();
  });

  test("/reset-password?resetToken=… switches into set-new-password mode", async ({ page }) => {
    await page.goto("/reset-password?resetToken=test-token-123");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
  });

  test("/cmc-scope-update without scopeRequestEventId shows an explanatory alert", async ({ page }) => {
    await page.goto("/cmc-scope-update");
    await expect(page.getByRole("alert")).toContainText("missing its scope-request reference");
  });
});

test.describe("smoke — account guards bounce to /signin (with preserved pryvServiceInfoUrl)", () => {
  test("/account/profile without session → /signin (carries pryvServiceInfoUrl)", async ({ page }) => {
    await page.goto(`/account/profile?pryvServiceInfoUrl=${encodeURIComponent(SVC)}`);
    await expect(page).toHaveURL(new RegExp(`/signin\\?pryvServiceInfoUrl=${encodeURIComponent(SVC).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("/change-password without session → /signin (carries pryvServiceInfoUrl)", async ({ page }) => {
    await page.goto(`/change-password?pryvServiceInfoUrl=${encodeURIComponent(SVC)}`);
    await expect(page).toHaveURL(new RegExp(`/signin\\?pryvServiceInfoUrl=${encodeURIComponent(SVC).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});

test.describe("smoke — sign-in mocked happy path + sign-out URL preservation regression", () => {
  test("sign-in → /account/profile?pryvServiceInfoUrl=…; sign-out → /signin?pryvServiceInfoUrl=…", async ({ page }) => {
    // Mock service-info, hostings, and the per-user auth/login + access-info endpoints.
    await page.route("**/reg.example.test/service/info", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          access: "https://access.example.test/access/",
          name: "Example",
          api: "https://{username}.example.test/",
          register: "https://reg.example.test/",
          serial: 1,
          version: "test",
          eventTypes: "https://example.test/etypes.json",
        }),
      }),
    );
    await page.route("**/alice.example.test/auth/login", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ token: "tok-alice", apiEndpoint: "https://alice.example.test/" }),
      }),
    );
    await page.route("**/alice.example.test/access-info", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "self-access", name: "pryv-user-account", type: "personal" }),
      }),
    );
    await page.route("**/alice.example.test/", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          { account: { username: "alice", email: "alice@example.test", language: "en", storageUsed: { dbDocuments: 0, attachedFiles: 0 } } },
        ]),
      }),
    );

    await page.goto(`/signin?pryvServiceInfoUrl=${encodeURIComponent(SVC)}`);
    await page.getByLabel("Username or email").fill("alice");
    await page.getByLabel("Password").fill("hunter2");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Landed on /account/profile with pryvServiceInfoUrl preserved.
    await expect(page).toHaveURL(new RegExp(`/account/profile\\?pryvServiceInfoUrl=${encodeURIComponent(SVC).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();

    // Sign out — URL preservation is the regression we shipped a fix for.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(new RegExp(`/signin\\?pryvServiceInfoUrl=${encodeURIComponent(SVC).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
