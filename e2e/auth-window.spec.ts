import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * `/auth` after the decision (here: Cancel on the sign-in card, which posts a
 * refusal). A pop-up opened by the app closes. A tab the page did not open (a
 * phone reached by redirection) cannot be closed by script: it goes back to the
 * app when the app gave a way back (`backUrl`), otherwise it shows the
 * "request complete" card. A pop-up is never navigated to the app.
 *
 * Browsers let a script close a tab whose history holds a single entry, so the
 * tab cases visit another page first, as a tab arriving from the app would.
 * Hermetic: the poll URL and the service info are mocked.
 */

const POLL = "https://reg.example.test/access/win1";
const SVC = "https://reg.example.test/service/info";
const BACK = "https://app.example.test/back";

async function mockPlatform(context: BrowserContext, posted: unknown[]) {
  await context.route("**/reg.example.test/access/win1", async (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "REFUSED" }) });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "NEED_SIGNIN",
        requestingAppId: "window-app",
        requestedPermissions: [{ streamId: "diary", defaultName: "Diary", level: "read" }],
      }),
    });
  });
  await context.route("**/reg.example.test/service/info", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        access: "https://reg.example.test/access/",
        register: "https://reg.example.test/",
        api: "https://{username}.example.test/",
        name: "Example",
      }),
    }),
  );
  await context.route("**/app.example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>The app</title><h1>Back in the app</h1>" }),
  );
}

function authPath(withBack: boolean) {
  return (
    "/auth?poll=" + encodeURIComponent(POLL) +
    "&pryvServiceInfoUrl=" + encodeURIComponent(SVC) +
    (withBack ? "&backUrl=" + encodeURIComponent(BACK) + "&backLabel=App" : "")
  );
}

test.describe("[AWN] /auth after the decision: close a pop-up, go back from a tab", () => {
  test("[AWN1] a tab with a way back returns to the app after Cancel", async ({ page, context }) => {
    const posted: unknown[] = [];
    await mockPlatform(context, posted);
    await page.goto("/signin"); // history > 1: the tab cannot be closed by script
    await page.goto(authPath(true));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForURL(BACK);
    await expect(page.getByRole("heading", { name: "Back in the app" })).toBeVisible();
    expect(posted).toHaveLength(1);
    expect((posted[0] as { status: string }).status).toBe("REFUSED");
  });

  test("[AWN2] a pop-up closes after Cancel and the opener is never navigated", async ({ page, context }) => {
    const posted: unknown[] = [];
    await mockPlatform(context, posted);
    await page.goto("/signin");
    const openerUrl = page.url();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.evaluate((path) => { window.open(path, "prYv Sign-in", "width=400,height=620"); }, authPath(true)),
    ]);
    await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Cancel" }).click();
    await closed;
    expect(page.url()).toBe(openerUrl);
    expect(posted.some((b) => (b as { status: string }).status === "REFUSED")).toBe(true);
  });

  test("[AWN6] a pop-up that fails to close is never sent to the app: it shows the complete card", async ({ page, context }) => {
    const posted: unknown[] = [];
    await mockPlatform(context, posted);
    // A real pop-up closes, so this makes the opener gate observable: close() is a no-op.
    await context.addInitScript(() => { window.close = () => {}; });
    await page.goto("/signin");
    const openerUrl = page.url();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.evaluate((path) => { window.open(path, "prYv Sign-in", "width=400,height=620"); }, authPath(true)),
    ]);
    await expect(popup.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await popup.getByRole("button", { name: "Cancel" }).click();
    await expect(popup.getByText("This request is complete")).toBeVisible();
    expect(popup.url()).toContain("/auth?");
    expect(page.url()).toBe(openerUrl);
    expect(posted.some((b) => (b as { status: string }).status === "REFUSED")).toBe(true);
  });

  test("[AWN4] Create account opens in the same window and keeps the request and the way back", async ({ page, context }) => {
    const posted: unknown[] = [];
    await mockPlatform(context, posted);
    await page.goto(authPath(true));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    let opened = 0;
    context.on("page", () => { opened++; });
    await page.getByRole("link", { name: "Create account" }).click();
    await page.waitForURL(/\/register\?/);
    expect(opened).toBe(0);
    const p = new URL(page.url()).searchParams;
    expect(p.get("poll")).toBe(POLL);
    expect(p.get("pryvServiceInfoUrl")).toBe(SVC);
    expect(p.get("backUrl")).toBe(BACK);
    expect(p.get("backLabel")).toBe("App");
    await expect(page.getByRole("link", { name: /Back to App/ })).toBeVisible();
  });

  test("[AWN3] a tab without a way back shows the request complete card", async ({ page, context }) => {
    const posted: unknown[] = [];
    await mockPlatform(context, posted);
    await page.goto("/signin");
    await page.goto(authPath(false));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("This request is complete")).toBeVisible();
    expect(page.url()).toContain("/auth?");
  });
});
