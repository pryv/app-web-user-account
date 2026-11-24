import { test, expect, type Page } from "@playwright/test";

/**
 * Username change (Profile) and aliased accesses (Connected apps), hermetic.
 *
 * The card reads the changes left with `account.usernameChanges` and changes
 * the name with `account.changeUsername`, after a confirmation in the app's
 * own dialog. The session then moves to the endpoint of the new name (built
 * from the service info's pattern, same token). An access created with
 * `randomAlias` shows the name the app knows the account by.
 */

const META = { apiVersion: "2.0.0-rc.87", serverTime: 1789560000, serial: "1" };
const SERVICE_INFO_URL = "https://reg.example.test/service/info";

async function signedIn(page: Page, opts: { remaining?: number } = {}) {
  const changes: unknown[] = [];
  let username = "alice";
  let remaining = opts.remaining ?? 2;
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
      }),
    }),
  );
  await page.route("**/access-info**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, type: "personal", user: { username } }),
    }),
  );
  const batch = (route: import("@playwright/test").Route) => {
    const body = route.request().postDataJSON() as Array<{ method: string; params: Record<string, unknown> }> | null;
    const results = (Array.isArray(body) ? body : []).map((call) => {
      if (call.method === "account.get") return { account: { username, email: "a@example.test", language: "en" } };
      if (call.method === "account.usernameChanges")
        return { usernameChangesUsed: 2 - remaining, usernameChangesLimit: 2, usernameChangesRemaining: remaining };
      if (call.method === "account.changeUsername") {
        changes.push({ host: new URL(route.request().url()).host, params: call.params });
        username = String(call.params.newUsername);
        remaining -= 1;
        return { account: { username }, usernameChangesRemaining: remaining, warnings: [] };
      }
      if (call.method === "accesses.get")
        return {
          accesses: [
            { id: "a1", name: "Study app", type: "shared", permissions: [], created: 1789000000, alias: "r-k7m2q9xa" },
            { id: "a2", name: "Diary app", type: "app", permissions: [], created: 1789000000 },
          ],
        };
      return {};
    });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ meta: META, results }) });
  };
  await page.route("https://alice.example.test/", batch);
  await page.route("https://bobby.example.test/", batch);
  await page.addInitScript(
    ([endpoint, svc]) => {
      if (!window.localStorage.getItem("pryv.session.apiEndpoint")) {
        window.localStorage.setItem("pryv.session.apiEndpoint", endpoint);
        window.localStorage.setItem("pryv.session.serviceInfoUrl", svc);
      }
    },
    ["https://tok@alice.example.test/", SERVICE_INFO_URL],
  );
  return { changes };
}

test("username change: confirmed in the app's dialog, the session moves to the new name", async ({ page }) => {
  const { changes } = await signedIn(page);
  await page.goto("/account/profile");
  await expect(page.getByTestId("profile-username")).toHaveText("alice");
  await expect(page.getByTestId("username-changes-left")).toHaveText("2 username changes left");

  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("New username").fill("Bobby");
  await expect(page.getByLabel("New username")).toHaveValue("bobby");
  await page.getByRole("button", { name: "Change username" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Change your username from alice to bobby?");
  await dialog.getByRole("button", { name: "Change username" }).click();

  await expect(page.getByText("Your username is now bobby. Use it to sign in.")).toBeVisible();
  await expect(page.getByTestId("profile-username")).toHaveText("bobby");
  await expect(page.getByTestId("username-changes-left")).toHaveText("1 username change left");
  expect(changes).toEqual([{ host: "alice.example.test", params: { newUsername: "bobby" } }]);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("pryv.session.apiEndpoint")))
    .toBe("https://tok@bobby.example.test/");

  // After a reload the session runs under the new name.
  await page.reload();
  await expect(page.getByTestId("profile-username")).toHaveText("bobby");
});

test("username change: none left, no Change button", async ({ page }) => {
  await signedIn(page, { remaining: 0 });
  await page.goto("/account/profile");
  await expect(page.getByTestId("username-changes-left")).toHaveText("No username changes left");
  await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
});

test("connected apps: an aliased access shows the name the app knows the account by", async ({ page }) => {
  await signedIn(page);
  await page.goto("/account/apps");
  const study = page.getByTestId("access-card").filter({ hasText: "Study app" });
  await expect(study.getByTestId("access-card-alias")).toHaveText(
    "Knows your account as r-k7m2q9xa, not by your username",
  );
  const diary = page.getByTestId("access-card").filter({ hasText: "Diary app" });
  await expect(diary.getByTestId("access-card-alias")).toHaveCount(0);
});
