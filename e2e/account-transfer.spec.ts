import { test, expect, type Page } from "@playwright/test";

/**
 * Account transfer, hermetic.
 *
 * The owner names a beneficiary in the "Automatic deletion" card
 * (`account.setAutoDeletion` with `action: "transfer"`). The beneficiary's
 * mailed links land on `/transfer-claim` and `/transfer-decline`; both call
 * public methods on the OWNER's core with the token, and the claim also
 * accepts a delegation invite on the beneficiary's OWN core. Two cores are
 * mocked: carol (the owner) and alice (the signed-in beneficiary).
 *
 * What they are guarding, specifically: the token and the owner's username
 * leave the address bar at once and never ride the sign-in hop, and the claim
 * runs its three steps against the right cores.
 */

/** Every mocked core response carries `meta`: the pryv client refuses one without it. */
const META = { apiVersion: "2.0.0-rc.46", serverTime: 1789560000, serial: "1" };
const ALICE_ENDPOINT = "https://tok@alice.example.test/";
const ALICE_ROUTE = "https://alice.example.test/";
const SERVICE_INFO_URL = "https://reg.example.test/service/info";
const SI_PARAM = "pryvServiceInfoUrl=" + encodeURIComponent(SERVICE_INFO_URL);

const FEATURE = {
  triggers: ["date", "inactivity"],
  actions: ["delete", "transfer"],
  reminderLeadDays: [60, 30, 7, 1],
  bounds: { minDays: 90, maxDays: 3650, minLeadDays: 14 },
  userOverride: true,
  allowUserOptOut: true,
  mailAvailable: true,
};

const NOW = Math.floor(Date.now() / 1000);
const NONE = {
  effective: { source: "none", mode: "never", action: "delete" },
  setting: null,
  lastActivity: { personal: NOW - 3600, app: null, delegate: null, max: NOW - 3600, by: "owner" },
  deadline: null,
  deleteAt: null,
  deadlineReason: null,
  nextReminderAt: null,
  remindersSent: [],
  blocked: null,
  mail: "available",
  bounds: FEATURE.bounds,
  userOverride: true,
  allowUserOptOut: true,
  actions: ["delete", "transfer"],
  transfer: null,
  claimWindowDays: 30,
};

async function mockServiceInfo(page: Page) {
  await page.route("**/service/info", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: META,
        register: "https://reg.example.test/",
        api: "https://{username}.example.test/",
        access: "https://reg.example.test/access/",
        name: "Test platform",
        serial: "1",
        features: { autoDeletion: FEATURE },
      }),
    }),
  );
}

/** alice signed in; her core answers the batch calls this suite needs. */
async function aliceSignedIn(page: Page) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let current: Record<string, unknown> = NONE;
  await mockServiceInfo(page);
  await page.route("**/access-info**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, type: "personal", user: { username: "alice" } }),
    }),
  );
  await page.route(ALICE_ROUTE, (route) => {
    const body = route.request().postDataJSON() as Array<{ method: string; params: Record<string, unknown> }> | null;
    const results = (Array.isArray(body) ? body : []).map((call) => {
      calls.push(call);
      if (call.method === "account.get") return { account: { username: "alice", email: "a@example.test", language: "en" } };
      if (call.method === "account.getAutoDeletion") return { autoDeletion: current };
      if (call.method === "account.setAutoDeletion") {
        const transfer = call.params.transfer as Record<string, unknown>;
        current = {
          ...NONE,
          effective: { source: "user", mode: "inactivity", inactivityDays: call.params.inactivityDays, action: "transfer" },
          setting: {
            mode: "inactivity",
            inactivityDays: call.params.inactivityDays,
            action: "transfer",
            transfer: { email: transfer.email, notifyBeneficiary: transfer.notifyBeneficiary, fallback: transfer.fallback },
            updatedAt: NOW,
          },
          deadline: NOW + Number(call.params.inactivityDays) * 86400,
          deadlineReason: "inactivity",
          transfer: { status: "named", email: transfer.email, beneficiaryNotifiedAt: NOW },
        };
        return { autoDeletion: current };
      }
      if (call.method === "delegations.acceptAttach") {
        return { delegation: { relId: "r1", status: "active", controlled: { username: call.params.username } } };
      }
      return {};
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ meta: META, results }) });
  });
  await page.addInitScript(
    ([endpoint, svc]) => {
      window.localStorage.setItem("pryv.session.apiEndpoint", endpoint);
      window.localStorage.setItem("pryv.session.serviceInfoUrl", svc);
    },
    [ALICE_ENDPOINT, SERVICE_INFO_URL],
  );
  return { calls };
}

test("account transfer: the owner names a beneficiary, with the password", async ({ page }) => {
  const { calls } = await aliceSignedIn(page);
  await page.goto("/account/data");
  const card = page.getByTestId("auto-deletion-card");
  await card.getByRole("radio", { name: "After a period without use" }).check();
  await card.getByRole("radio", { name: "Transfer my account to someone" }).check();
  await card.getByLabel("Email address of the person who takes over").fill("bob@example.test");
  await expect(card.getByTestId("auto-deletion-identity-notice")).toContainText("(Test platform)");
  await card.getByRole("radio", { name: "Keep the account" }).check();
  await card.getByRole("button", { name: "Save" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("bob@example.test will be invited to take over the management of your account");
  await expect(dialog).toContainText("They will have 30 days to accept");
  await dialog.getByLabel("Password").fill("s3cret");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(card.getByText("Your choice is saved.")).toBeVisible();
  const status = card.getByTestId("auto-deletion-status");
  await expect(status).toContainText("transferred to bob@example.test after 365 days without use");
  await expect(status).toContainText("If they do not take it over within 30 days, your account is kept.");
  await expect(status).toContainText("bob@example.test was told on");
  expect(calls.filter((c) => c.method === "account.setAutoDeletion").map((c) => c.params)).toEqual([
    {
      mode: "inactivity",
      inactivityDays: 365,
      action: "transfer",
      transfer: { email: "bob@example.test", notifyBeneficiary: "atSetup", fallback: "keep" },
      password: "s3cret",
    },
  ]);
});

test("/transfer-claim signed out: the link leaves the address bar and the sign-in link", async ({ page }) => {
  await mockServiceInfo(page);
  await page.goto(`/transfer-claim?username=carol&token=SECRET-TOKEN&${SI_PARAM}`);
  await expect(page.getByTestId("transfer-claim-intro")).toHaveText(
    "You were invited to take over the management of the account carol.",
  );
  await expect.poll(() => page.url()).not.toContain("SECRET-TOKEN");
  expect(page.url()).not.toContain("username=");
  const signIn = await page.getByRole("link", { name: "Sign in to accept" }).getAttribute("href");
  expect(signIn).toContain("next=%2Ftransfer-claim");
  expect(signIn).not.toContain("SECRET-TOKEN");
  expect(signIn).not.toContain("username=");
});

test("/transfer-claim signed in: claim on the owner's core, accept on our own, claim again", async ({ page }) => {
  const { calls } = await aliceSignedIn(page);
  const claims: unknown[] = [];
  await page.route("https://carol.example.test/account/auto-deletion/transfer-claim", (route) => {
    claims.push(route.request().postDataJSON());
    const status = claims.length === 1 ? "invited" : "completed";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, transfer: { status, username: "carol" } }),
    });
  });
  await page.goto(`/transfer-claim?username=carol&token=SECRET-TOKEN&${SI_PARAM}`);
  await expect.poll(() => page.url()).not.toContain("SECRET-TOKEN");
  await page.getByRole("button", { name: "Accept as alice" }).click();
  await expect(page.getByText("You now manage the account carol. Open it from Accounts I manage.")).toBeVisible();
  expect(claims).toHaveLength(2);
  expect(claims[0]).toMatchObject({ token: "SECRET-TOKEN", claimant: "alice" });
  expect(calls.filter((c) => c.method === "delegations.acceptAttach").map((c) => c.params)).toEqual([{ username: "carol" }]);
  await expect(page.getByRole("link", { name: "Go to Accounts I manage" })).toHaveAttribute("href", /^\/account\/delegation\?/);
});

test("/transfer-decline: the token leaves the address bar, Decline tells the holder", async ({ page }) => {
  await mockServiceInfo(page);
  const declines: unknown[] = [];
  await page.route("https://carol.example.test/account/auto-deletion/transfer-decline", (route) => {
    declines.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, declined: true }),
    });
  });
  await page.goto(`/transfer-decline?username=carol&token=SECRET-TOKEN&${SI_PARAM}`);
  await expect(page.getByTestId("transfer-decline-question")).toHaveText("Decline taking over the account carol?");
  await expect.poll(() => page.url()).not.toContain("SECRET-TOKEN");
  expect(page.url()).not.toContain("username=");
  // The full address of a page opened from a mailed link never goes to another origin.
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "same-origin");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Declined; the account holder has been told.")).toBeVisible();
  expect(declines).toEqual([expect.objectContaining({ token: "SECRET-TOKEN" })]);
});
