import i18n from "../i18n";

/**
 * Run `run` with the page's language set to `lang`, then restore it. This
 * build ships English only, so i18next keeps "en" on `changeLanguage`: the
 * field is set directly, the way the date helpers read it.
 */
export function withLanguage(lang: string, run: () => void): void {
  const page = i18n as { language: string };
  const before = page.language;
  page.language = lang;
  try {
    run();
  } finally {
    page.language = before;
  }
}
