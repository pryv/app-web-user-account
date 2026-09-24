import { test, expect } from "@playwright/test";

/**
 * Email verification, hermetic. Every core call is mocked with `page.route`, so
 * these run with no platform and no mailbox.
 *
 * What they are guarding, specifically:
 *  - the `/verify-email` page must DROP the token from the address bar as soon
 *    as it reads it. That is the whole Referer/history protection, and it is
 *    invisible to a unit test.
 *  - the registration page must render the right one of its three shapes for
 *    what the platform advertises. Picking the wrong shape either blocks
 *    sign-up on a core with no gate, or lets a gated core refuse the request.
 *  - a spent token must surface as guidance, not as a raw server sentence.
 */

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
};

/** Every page here needs to know its platform; the link carries it. */
const SI_PARAM = "pryvServiceInfoUrl=" + encodeURIComponent("https://reg.example.test/service/info");

/** Serve a service-info with the given emailVerification feature flags. */
async function mockServiceInfo(
  page: import("@playwright/test").Page,
  features: { atRegistration: boolean; onAccount: boolean },
) {
  // Keep this pattern SPECIFIC. A blanket `**/reg/**` also matches
  // `https://reg.example.test/service/info`, and Playwright matches the most
  // recently registered route first — which silently replaced the service-info
  // body and surfaced as "Invalid data from service/info".
  await page.route("**/service/info", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...SERVICE_INFO, features: { emailVerification: features } }),
    }),
  );
}

test.describe("/verify-email", () => {
  test("drops the token from the address bar but keeps it in the field", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: true });
    await page.goto(`/verify-email?verifyToken=SECRET-TOKEN-123&username=alice&${SI_PARAM}`);

    await expect(page.getByRole("heading", { name: "Verify your email address" })).toBeVisible();
    // The username came from the link, so it is shown rather than asked for.
    await expect(page.getByText("alice")).toBeVisible();
    // The token is still usable...
    await expect(page.getByLabel("Verification code")).toHaveValue("SECRET-TOKEN-123");
    // ...but it must no longer be in the URL.
    expect(page.url()).not.toContain("SECRET-TOKEN-123");
    expect(page.url()).not.toContain("verifyToken");
    expect(page.url()).toContain("username=alice");
  });

  test("asks for the username when the link did not carry one", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: true });
    await page.goto(`/verify-email?verifyToken=T&${SI_PARAM}`);
    await expect(page.getByLabel("Username")).toBeVisible();
  });

  test("confirms the address on success", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: true });
    await page.route("**/account/verify-email", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "alice@example.test" }),
      }),
    );
    await page.goto(`/verify-email?verifyToken=GOOD&username=alice&${SI_PARAM}`);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await expect(page.getByText("alice@example.test")).toBeVisible();
  });

  test("renders a spent token as guidance, not the raw server message", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: true });
    await page.route("**/account/verify-email", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { id: "invalid-access-token", message: "raw server sentence" } }),
      }),
    );
    await page.goto(`/verify-email?verifyToken=SPENT&username=alice&${SI_PARAM}`);
    await page.getByRole("button", { name: "Verify email" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("invalid or has expired");
    await expect(alert).not.toContainText("raw server sentence");
  });
});

test.describe("/register — the three shapes", () => {
  test("gate ON: email is required and the code step appears", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: true, onAccount: true });
    await page.goto(`/register?${SI_PARAM}`);
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expect(page.getByText("We will send you a verification code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send verification code" })).toBeVisible();
    // Submitting is impossible until the address is proved.
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  });

  test("gate OFF: email is optional and no code step is shown", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: true });
    await page.goto(`/register?${SI_PARAM}`);
    await expect(page.getByText("Optional, but required to reset your password.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send verification code" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("neither feature: the plain optional-email form, no opt-in", async ({ page }) => {
    await mockServiceInfo(page, { atRegistration: false, onAccount: false });
    await page.goto(`/register?${SI_PARAM}`);
    await page.getByLabel("Email", { exact: true }).fill("someone@example.test");
    await expect(page.getByText("Confirm this address")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send verification code" })).toHaveCount(0);
  });
});
