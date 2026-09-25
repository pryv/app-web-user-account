// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import i18n, { hasExplicitLangParam, syncLocaleFromAccount, SUPPORTED_LOCALES } from "./i18n";

/** [I18N] Language precedence and catalog parity. */

function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatKeys(v as Record<string, unknown>, key));
    else out.push(key);
  }
  return out.sort();
}

const LOCALES_DIR = join(__dirname, "locales");
const readCatalog = (file: string) => JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")) as Record<string, unknown>;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("[I18N] language precedence", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("[I181] detects an explicit, supported ?lang=", () => {
    expect(hasExplicitLangParam("?lang=en")).toBe(true);
    expect(hasExplicitLangParam("?lang=en-GB")).toBe(true);
    expect(hasExplicitLangParam("?lang=xx")).toBe(false);
    expect(hasExplicitLangParam("")).toBe(false);
  });

  it("[I182] ignores an account language this build does not ship", async () => {
    syncLocaleFromAccount("xx");
    syncLocaleFromAccount(null);
    await settle();
    expect(i18n.language.split("-")[0]).toBe("en");
  });

  it("[I183] interpolates the brand into copy", () => {
    expect(i18n.t("register.subtitle")).not.toContain("{{");
    expect(i18n.t("common.logoAlt")).not.toBe("");
  });
});

describe("[I18N] catalogs", () => {
  it("[I184] every catalog in src/locales has exactly the keys of en.json", () => {
    const enKeys = flatKeys(readCatalog("en.json"));
    for (const file of readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json") && f !== "en.json")) {
      expect({ file, keys: flatKeys(readCatalog(file)) }).toEqual({ file, keys: enKeys });
    }
  });

  it("[I185] every shipped language has a catalog", () => {
    const files = readdirSync(LOCALES_DIR);
    for (const code of SUPPORTED_LOCALES) expect(files).toContain(`${code}.json`);
  });
});
