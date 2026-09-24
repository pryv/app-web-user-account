import { test, expect } from "@playwright/test";

/**
 * Terms acceptance at registration, hermetic. A deployment whose settings.json
 * names its legal documents gets a required checkbox; the dev server serves `{}`,
 * so the other /register tests see no checkbox at all.
 */

const SI_PARAM = "pryvServiceInfoUrl=" + encodeURIComponent("https://reg.example.test/service/info");

test("settings.json legal links: the checkbox gates Create account", async ({ page }) => {
  await page.route("**/settings.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        legal: {
          terms: { en: "https://legal.example.test/terms-en", fr: "https://legal.example.test/terms-fr" },
          privacy: "https://legal.example.test/privacy",
        },
      }),
    }),
  );
  await page.route("**/service/info", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        register: "https://reg.example.test/",
        api: "https://{username}.example.test/",
        access: "https://reg.example.test/access/",
        name: "Test platform",
        serial: "1",
        features: { emailVerification: { atRegistration: false, onAccount: false } },
      }),
    }),
  );
  await page.goto(`/register?${SI_PARAM}`);

  const box = page.locator("#acceptTerms");
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(box).not.toBeChecked();
  await expect(page.getByRole("link", { name: "Terms of use" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
    "href",
    "https://legal.example.test/privacy",
  );
  await expect(submit).toBeDisabled();
  await box.check();
  await expect(submit).toBeEnabled();
  await box.uncheck();
  await expect(submit).toBeDisabled();
});
