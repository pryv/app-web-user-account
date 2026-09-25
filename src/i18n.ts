import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { brand } from "./brand";

import en from "./locales/en.json";

/**
 * Languages this build ships. To add one: drop `src/locales/<code>.json`
 * next to `en.json`, import it below, and list the code here; the parity test
 * refuses a catalog that misses or adds keys.
 */
export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Language precedence:
 *   1. `?lang=`, the explicit signal an entry link or the auth ceremony passes;
 *   2. the account's `language`, applied after sign-in by
 *      `syncLocaleFromAccount()`, unless `?lang=` was given;
 *   3. the browser;
 *   4. English.
 *
 * `caches: []`: the detected language is never persisted, so a `?lang=` does
 * not outlive the link that carried it.
 */
void i18n
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    nonExplicitSupportedLngs: true, // "fr-CH" -> "fr"
    interpolation: {
      escapeValue: false, // React already escapes
      defaultVariables: { product: brand.productName, account: brand.accountNoun },
    },
    detection: {
      order: ["querystring", "navigator"],
      lookupQuerystring: "lang",
      caches: [],
    },
    resources: {
      en: { translation: en },
    },
  });

/** Whether the current page was given an explicit, supported `?lang=`. */
export function hasExplicitLangParam(search: string = window.location.search): boolean {
  const v = new URLSearchParams(search).get("lang");
  return !!v && SUPPORTED_LOCALES.includes(v.split("-")[0] as Locale);
}

/**
 * Adopt the account's `language` as the UI language after sign-in, unless the
 * page was opened with an explicit `?lang=`, which wins for that visit.
 */
export function syncLocaleFromAccount(language: string | null | undefined): void {
  if (!language || hasExplicitLangParam()) return;
  const base = language.split("-")[0];
  if (SUPPORTED_LOCALES.includes(base as Locale) && i18n.language.split("-")[0] !== base) {
    void i18n.changeLanguage(base);
  }
}

export default i18n;
