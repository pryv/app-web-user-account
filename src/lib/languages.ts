import { SUPPORTED_LOCALES } from "../i18n";

/** Each language's name in itself, for the language choice. */
const NATIVE_NAMES: Record<string, string> = { en: "English" };

function nativeName(code: string): string {
  if (NATIVE_NAMES[code]) return NATIVE_NAMES[code];
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Languages the account's `language` setting can be set to from the Profile
 * page: the ones this build ships (`SUPPORTED_LOCALES`). With a single entry
 * the Profile page shows the language read-only.
 */
export const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = SUPPORTED_LOCALES.map((code) => ({
  value: code,
  label: nativeName(code),
}));
