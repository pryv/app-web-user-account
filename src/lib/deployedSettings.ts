/**
 * Per-deployment configuration, served next to the bundle as `settings.json`.
 *
 * A deployment usually serves one Pryv platform, so it can say which one here
 * instead of requiring `pryvServiceInfoUrl` on every entry link. Loaded once at
 * boot (see main.tsx) so `getService()` stays synchronous. Every key is
 * optional; the shipped file is `{}`, which keeps the param-required behaviour.
 *
 *   {
 *     "serviceInfoUrl": "https://reg.example.com/service/info",
 *     "trustedApiOrigins": ["https://core.example.com"],
 *     "legal": { "terms": { "en": "https://..." }, "privacy": "https://..." },
 *     "appCatalogUrl": "https://assets.example.com/apps/list.json",
 *     "theme": { "default": "system", "userChoice": true }
 *   }
 *
 * Precedence for the same concern: URL parameter, then settings.json, then the
 * build-time env. The trust list is the exception: never taken from the URL, and
 * the settings.json list is added to the build-time one (see trustedOrigins.ts).
 */

import { httpUrlOrNull } from "./safeRedirect";
import { parseLegalSettings, type LegalSettings } from "./legal";
import i18n from "../i18n";
import { isThemeChoice, type ThemeSettings } from "./theme";

export interface DeployedSettings {
  serviceInfoUrl?: string;
  /**
   * When set, the only platforms this deployment talks to (with
   * `serviceInfoUrl`). A link naming another one is refused, so a crafted
   * link cannot send the user's password to a platform the operator never
   * chose. Unset: any platform, as before.
   *
   * An access request's poll URL is accepted when it is served from an origin
   * the platform's service info declares (`register`, `access`, `api`; with an
   * `https://{username}.example.com/` api, any host one label under
   * `example.com`, which covers the cores of a DNS-based platform). Cores whose
   * origin service info does not name (several cores behind a path-style api)
   * must be listed in `trustedApiOrigins`.
   */
  allowedServiceInfoUrls?: string[];
  trustedApiOrigins?: string[];
  legal?: LegalSettings;
  appCatalogUrl?: string;
  /** Only the keys the file sets validly; see getThemeSettings() for defaults. */
  theme?: Partial<ThemeSettings>;
}

/**
 * Hard cap on the boot fetch. The app renders after it, so a server that
 * accepts the connection and never answers must not leave a blank page.
 */
export const BOOT_FETCH_TIMEOUT_MS = 4000;

let current: DeployedSettings = {};

/** An absolute http(s) URL string, or undefined. */
function url(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return httpUrlOrNull(value) ? value : undefined;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Exact origins only (scheme + host + port); anything else is dropped. These
 * are trusted with credentials, so plain http is kept for loopback only.
 */
function origins(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const parsed = httpUrlOrNull(item.trim());
    if (!parsed) continue;
    if (parsed.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsed.hostname)) continue;
    out.push(parsed.origin);
  }
  return out.length > 0 ? out : undefined;
}

/** `{ default, userChoice }`, keeping only valid values; undefined when none is. */
function themeSettings(raw: unknown): Partial<ThemeSettings> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const json = raw as Record<string, unknown>;
  const out: Partial<ThemeSettings> = {};
  if (isThemeChoice(json.default)) out.default = json.default;
  if (typeof json.userChoice === "boolean") out.userChoice = json.userChoice;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Narrow an untrusted settings.json body onto `DeployedSettings`. */
export function parseDeployedSettings(raw: unknown): DeployedSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const json = raw as Record<string, unknown>;
  const out: DeployedSettings = {};
  const serviceInfoUrl = url(json.serviceInfoUrl);
  if (serviceInfoUrl) out.serviceInfoUrl = serviceInfoUrl;
  if (Array.isArray(json.allowedServiceInfoUrls)) {
    // Kept even when empty: a restriction that parses to nothing means "the
    // default platform only", never "no restriction" (fail closed).
    out.allowedServiceInfoUrls = json.allowedServiceInfoUrls
      .map(url)
      .filter((u): u is string => u != null);
  }
  const trusted = origins(json.trustedApiOrigins);
  if (trusted) out.trustedApiOrigins = trusted;
  const legal = parseLegalSettings(json.legal);
  if (legal) out.legal = legal;
  const appCatalogUrl = url(json.appCatalogUrl);
  if (appCatalogUrl) out.appCatalogUrl = appCatalogUrl;
  const theme = themeSettings(json.theme);
  if (theme) out.theme = theme;
  return out;
}

/**
 * Fetch the deployment's settings.json. Never throws and never blocks past
 * BOOT_FETCH_TIMEOUT_MS: a miss, a malformed body or a hang leaves every value
 * unset.
 */
export async function loadDeployedSettings(fetchImpl: typeof fetch = fetch): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, BOOT_FETCH_TIMEOUT_MS);
  });
  try {
    const body = await Promise.race([
      (async () => {
        const response = await fetchImpl(`${import.meta.env.BASE_URL}settings.json`, {
          cache: "no-cache",
          signal: controller.signal,
        });
        return response.ok ? ((await response.json()) as unknown) : null;
      })().catch(() => null),
      timeout,
    ]);
    current = parseDeployedSettings(body);
  } finally {
    clearTimeout(timer);
  }
}

/** The deployment's default platform, or null. */
export function getDefaultServiceInfoUrl(): string | null {
  return current.serviceInfoUrl ?? null;
}

/** Whether two URL strings name the same URL once normalised. */
export function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/**
 * Whether this deployment may talk to the platform at `serviceInfoUrl`.
 * Always true unless settings.json sets `allowedServiceInfoUrls`; then only
 * those and the default `serviceInfoUrl` are allowed.
 */
export function isAllowedServiceInfoUrl(serviceInfoUrl: string): boolean {
  const allowed = current.allowedServiceInfoUrls;
  if (!allowed) return true;
  const candidates = current.serviceInfoUrl ? [...allowed, current.serviceInfoUrl] : allowed;
  return candidates.some((c) => sameUrl(c, serviceInfoUrl));
}

/**
 * The platforms this deployment is restricted to (`allowedServiceInfoUrls` plus
 * the default `serviceInfoUrl`), or null when it serves any platform.
 */
export function getAllowedPlatforms(): string[] | null {
  const allowed = current.allowedServiceInfoUrls;
  if (!allowed) return null;
  const all = current.serviceInfoUrl ? [current.serviceInfoUrl, ...allowed] : [...allowed];
  return all.filter((u, i) => all.findIndex((o) => sameUrl(o, u)) === i);
}

/** Message shown when a link names a platform this deployment does not serve. */
export function platformNotAllowedMessage(): string {
  return i18n.t("errors.platformNotAllowed");
}

/** Thrown when a link names a platform this deployment does not serve. */
export class PlatformNotAllowedError extends Error {
  constructor() {
    super(platformNotAllowedMessage());
    this.name = "PlatformNotAllowedError";
  }
}

/** Extra trusted core origins from settings.json ([] when unset). */
export function getTrustedApiOrigins(): string[] {
  return current.trustedApiOrigins ?? [];
}

/** The deployment's legal-document links, or null. */
export function getLegalSettings(): LegalSettings | null {
  return current.legal ?? null;
}

/** Where the operator publishes its app catalog, or null. */
export function getAppCatalogUrl(): string | null {
  return current.appCatalogUrl ?? null;
}

/** The operator's theme ruling: default `system`, user choice allowed unless set to false. */
export function getThemeSettings(): ThemeSettings {
  return {
    default: current.theme?.default ?? "system",
    userChoice: current.theme?.userChoice ?? true,
  };
}

/** Test hook: set what loadDeployedSettings() would have parsed. */
export function _setDeployedSettingsForTest(s: DeployedSettings | null): void {
  current = s ?? {};
}
