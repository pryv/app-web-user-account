/**
 * Links to the operator's legal documents, shown at registration.
 *
 * `settings.json` may carry a `legal` block; each entry is either one URL or a
 * per-language map (`{ "en": "...", "fr": "..." }`). The Terms fall back to the
 * platform's service-info `terms` when settings.json does not name them.
 *
 *   { "legal": { "terms": { "en": "...", "fr": "..." }, "privacy": "..." } }
 *
 * Only absolute http(s) URLs are kept: these links render on the registration
 * page, where a `javascript:` URL would be the obvious abuse.
 */

import { httpUrlOrNull } from "./safeRedirect";

export type LocalizedUrl = string | Record<string, string>;

export interface LegalSettings {
  terms?: LocalizedUrl;
  privacy?: LocalizedUrl;
}

/** The URL when it is an absolute http(s) URL, else null. */
export function safeLegalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return httpUrlOrNull(value) ? value : null;
}

/** Pick the URL for `lang` (`fr-CH` -> `fr`), else `en`, else the first entry. */
export function resolveLocalizedUrl(value: LocalizedUrl | undefined, lang: string): string | null {
  if (!value) return null;
  if (typeof value === "string") return safeLegalUrl(value);
  const base = lang.split("-")[0];
  const candidate = value[lang] ?? value[base] ?? value.en ?? Object.values(value)[0];
  return safeLegalUrl(candidate);
}

/** Narrow an unknown `legal` value from settings.json onto the shape above. */
export function parseLegalSettings(raw: unknown): LegalSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out: LegalSettings = {};
  for (const key of ["terms", "privacy"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string") {
      const url = safeLegalUrl(v);
      if (url) out[key] = url;
    } else if (typeof v === "object" && v !== null) {
      const map: Record<string, string> = {};
      for (const [lang, u] of Object.entries(v as Record<string, unknown>)) {
        const url = safeLegalUrl(u);
        if (url) map[lang] = url;
      }
      if (Object.keys(map).length > 0) out[key] = map;
    }
  }
  return out.terms || out.privacy ? out : null;
}
