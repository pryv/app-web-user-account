import { test, expect, type Page } from "@playwright/test";

/**
 * "Automatic deletion" card (Your data), hermetic.
 *
 * The platform offers the feature in its service info; the card reads the
 * schedule with `account.getAutoDeletion` and changes it with
 * `account.setAutoDeletion`, both through the batch endpoint. Arming a
 * schedule asks the account password in the app's own dialog; a delegate
 * session sees the schedule without the controls.
 */

/** Every mocked core response carries `meta`: the pryv client refuses one without it. */
const META = { apiVersion: "2.0.0-rc.46", serverTime: 1789560000, serial: "1" };
const ENDPOINT = "https://tok@alice.example.test/";
const ENDPOINT_ROUTE = "https://alice.example.test/";
const SERVICE_INFO_URL = "https://reg.example.test/service/info";

const FEATURE = {
  triggers: ["date", "inactivity"],
  actions: ["delete"],
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
  actions: ["delete"],
};

async function signedIn(page: Page, opts: { delegated?: boolean } = {}) {
  const sets: unknown[] = [];
  let current: Record<string, unknown> = NONE;
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
  await page.route("**/access-info**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: META,
        type: "personal",
        user: { username: "alice" },
        ...(opts.delegated
          ? { delegation: { isDelegatedAccess: true, controlledUsername: "alice", delegate: { username: "bob" } } }
          : {}),
      }),
    }),
  );
  await page.route(ENDPOINT_ROUTE, (route) => {
    const body = route.request().postDataJSON() as Array<{ method: string; params: Record<string, unknown> }> | null;
    const results = (Array.isArray(body) ? body : []).map((call) => {
      if (call.method === "account.get") return { account: { username: "alice", email: "a@example.test", language: "en" } };
      if (call.method === "account.getAutoDeletion") return { autoDeletion: current };
      if (call.method === "account.setAutoDeletion") {
        sets.push(call.params);
        current = {
          ...NONE,
          effective: { source: "user", mode: "inactivity", inactivityDays: call.params.inactivityDays, action: "delete" },
          setting: { mode: "inactivity", inactivityDays: call.params.inactivityDays, action: "delete", updatedAt: NOW },
          deadline: NOW + Number(call.params.inactivityDays) * 86400,
          deadlineReason: "inactivity",
        };
        return { autoDeletion: current };
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
    [ENDPOINT, SERVICE_INFO_URL],
  );
  return { sets };
}

test("automatic deletion: arming a period asks the password, then shows the schedule", async ({ page }) => {
  const { sets } = await signedIn(page);
  await page.goto("/account/data");
  const card = page.getByTestId("auto-deletion-card");
  await expect(card.getByText("No automatic deletion is scheduled for your account.")).toBeVisible();

  await card.getByRole("radio", { name: "After a period without use" }).check();
  await card.getByLabel("Period without use", { exact: true }).selectOption("730");
  await card.getByRole("button", { name: "Save" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("permanently deleted after 730 days without use");
  await dialog.getByLabel("Password").fill("s3cret");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(card.getByText("Your choice is saved.")).toBeVisible();
  await expect(card.getByTestId("auto-deletion-status")).toContainText("after 730 days without use: currently on");
  expect(sets).toEqual([{ mode: "inactivity", inactivityDays: 730, action: "delete", password: "s3cret" }]);
});

test("automatic deletion: a delegate session sees the schedule, not the controls", async ({ page }) => {
  await signedIn(page, { delegated: true });
  await page.goto("/account/data");
  const card = page.getByTestId("auto-deletion-card");
  await expect(card.getByText("No automatic deletion is scheduled for your account.")).toBeVisible();
  await expect(card.getByTestId("auto-deletion-delegate-note")).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(0);
});
