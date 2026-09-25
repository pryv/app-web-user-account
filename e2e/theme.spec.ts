import { test, expect, type Page } from "@playwright/test";

/**
 * Light / dark theme: the OS preference by default, the operator's
 * settings.json `theme` ruling, and the user's pick in the header toggle.
 */

const LIGHT_BODY = "rgb(244, 244, 244)";
const DARK_BODY = "rgb(19, 21, 22)";

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

function serveSettings(page: Page, settings: unknown) {
  return page.route("**/settings.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(settings) }),
  );
}

async function openSignIn(page: Page) {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

test.describe("theme", () => {
  test("follows a dark OS preference by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openSignIn(page);
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BODY);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BODY);
  });

  test("an operator default of light stays light under a dark OS", async ({ page }) => {
    await serveSettings(page, { theme: { default: "light" } });
    await page.emulateMedia({ colorScheme: "dark" });
    await openSignIn(page);
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BODY);
    await expect(page.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the user's pick applies at once and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSignIn(page);
    const group = page.getByRole("group", { name: "Theme" });
    await group.getByRole("button", { name: "Dark theme" }).click();
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BODY);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BODY);
    await expect(page.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Use system theme" }).click();
    await expect.poll(() => bodyBackground(page)).toBe(LIGHT_BODY);
  });

  test("userChoice false hides the toggle and ignores a stored pick", async ({ page }) => {
    await serveSettings(page, { theme: { default: "dark", userChoice: false } });
    await page.addInitScript(() => localStorage.setItem("pryv.theme", "light"));
    await page.emulateMedia({ colorScheme: "light" });
    await openSignIn(page);
    await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);
    await expect.poll(() => bodyBackground(page)).toBe(DARK_BODY);
  });
});
