/**
 * The operator-curated app catalog: how a consent screen learns a requesting
 * app's real name instead of showing its raw id.
 *
 * **Why the catalog and not the app itself.** A name the requesting app
 * supplies is self-asserted, so any app could call itself "Official Support"
 * on the one screen where the user decides to trust it. The catalog is
 * published by the operator (settings.json `appCatalogUrl`), so an app cannot
 * write its own entry. That makes this a security control, not a formatting
 * nicety: the lookup is by `id` only, and nothing here ever falls back to a
 * display string that came from the requester.
 *
 * **Never blocks consent.** Every failure path (no URL configured, network
 * error, timeout, oversized or malformed file) resolves to an empty catalog, so
 * the screen renders with the raw id rather than stalling or erroring.
 *
 * File format (`apps/list.json`, schema v1):
 *   { schemaVersion: 1, apps: [{ id, name, description?: { en, fr?, es? },
 *     icon?: { type: "emoji" | "base64" | "url", value }, provider? }] }
 */

import { getAppCatalogUrl } from "./deployedSettings";
import { httpUrlOrNull } from "./safeRedirect";

/** Highest `schemaVersion` this reader understands. */
export const KNOWN_SCHEMA_VERSION = 1;

/** Hard cap on the catalog fetch: a consent screen must not wait on it. */
export const CATALOG_FETCH_TIMEOUT_MS = 4000;
/** Largest catalog file accepted, in characters. */
export const MAX_CATALOG_CHARS = 1_000_000;
/** Largest icon value accepted, per type, in characters. */
export const MAX_ICON_CHARS = { emoji: 16, url: 2048, base64: 100_000 } as const;

export interface LocalizedText {
  en: string;
  fr?: string;
  es?: string;
}

export interface CatalogIcon {
  type: "emoji" | "base64" | "url";
  value: string;
}

/** The identity subset of a catalog entry: the only fields a consent screen needs. */
export interface CatalogApp {
  id: string;
  name: string;
  description?: LocalizedText;
  icon?: CatalogIcon;
  provider?: string;
}

export type AppCatalog = ReadonlyMap<string, CatalogApp>;

const EMPTY: AppCatalog = new Map();

let cache: { url: string | null; catalog: Promise<AppCatalog> } | null = null;

/** Drop the memoised catalog (tests, and any future explicit refresh). */
export function resetAppCatalog(): void {
  cache = null;
}

/**
 * The operator's app catalog. Never rejects.
 *
 * Takes the platform's service-info URL for signature parity with forks that
 * discover a catalog per platform; this implementation reads the one URL the
 * deployment's settings.json names, and memoises per that URL.
 */
export function getAppCatalog(_serviceInfoUrl: string): Promise<AppCatalog> {
  const url = getAppCatalogUrl();
  if (cache == null || cache.url !== url) {
    cache = { url, catalog: url == null ? Promise.resolve(EMPTY) : fetchCatalog(url) };
  }
  return cache.catalog;
}

async function fetchCatalog(url: string): Promise<AppCatalog> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_CATALOG_CHARS) throw new Error("catalog too large");
    const text = await res.text();
    if (text.length > MAX_CATALOG_CHARS) throw new Error("catalog too large");
    return parseCatalog(JSON.parse(text));
  } catch (err) {
    // Deliberately a warning, not a throw: an unreachable catalog must degrade
    // to the raw app id, never block or break the consent screen.
    console.warn("[appCatalog] app catalog unavailable:", err);
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate the catalog file and index its entries by id.
 *
 * Exported for tests, and kept pure: a malformed or future-versioned file
 * yields an empty catalog rather than a partially-trusted one.
 */
export function parseCatalog(list: unknown): AppCatalog {
  if (list == null || typeof list !== "object") return EMPTY;
  const { schemaVersion, apps } = list as { schemaVersion?: unknown; apps?: unknown };
  if (typeof schemaVersion !== "number") return EMPTY;
  // A newer schema may have changed the meaning of the identity fields, and
  // guessing on a consent screen is exactly the wrong place to be optimistic.
  if (schemaVersion > KNOWN_SCHEMA_VERSION) return EMPTY;
  if (!Array.isArray(apps)) return EMPTY;

  const out = new Map<string, CatalogApp>();
  for (const raw of apps) {
    const app = asCatalogApp(raw);
    if (app) out.set(app.id, app);
  }
  return out;
}

export function asCatalogApp(raw: unknown): CatalogApp | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  if (typeof r.name !== "string" || r.name === "") return null;
  return {
    id: r.id,
    name: r.name,
    description: asLocalizedText(r.description),
    icon: asIcon(r.icon),
    provider: typeof r.provider === "string" ? r.provider : undefined,
  };
}

function asLocalizedText(v: unknown): LocalizedText | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t.en !== "string") return undefined;
  return {
    en: t.en,
    fr: typeof t.fr === "string" ? t.fr : undefined,
    es: typeof t.es === "string" ? t.es : undefined,
  };
}

/**
 * Raster image data URLs only. SVG is excluded: it is a script-capable
 * document type, and an icon never needs to be one.
 */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * An icon the consent screen may render, or undefined. Rejected: unknown
 * types, empty or oversized values, `url` values that are not absolute
 * http(s), `base64` values that are not a raster image data URL.
 */
function asIcon(v: unknown): CatalogIcon | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const i = v as Record<string, unknown>;
  if (i.type !== "emoji" && i.type !== "base64" && i.type !== "url") return undefined;
  if (typeof i.value !== "string" || i.value === "") return undefined;
  if (i.value.length > MAX_ICON_CHARS[i.type]) return undefined;
  if (i.type === "url" && httpUrlOrNull(i.value) == null) return undefined;
  if (i.type === "base64" && !IMAGE_DATA_URL.test(i.value)) return undefined;
  return { type: i.type, value: i.value };
}

/**
 * Pick the catalog's localized text for the active UI language, falling back
 * to `en`; an empty string counts as absent.
 */
export function localizeCatalogText(
  text: LocalizedText | undefined,
  language: string,
): string | null {
  if (text == null) return null;
  const base = language.split("-")[0];
  const byLang = (text as unknown as Record<string, string | undefined>)[base];
  if (typeof byLang === "string" && byLang !== "") return byLang;
  return typeof text.en === "string" && text.en !== "" ? text.en : null;
}

/**
 * How a requesting app should be identified on a consent screen.
 *
 * Returns the catalog's curated name / icon / localized description when the
 * id is known, and `null` when it is not: callers then keep showing the raw
 * id, which is honest about the fact that the operator cannot vouch for it.
 */
export function resolveRequestingApp(
  catalog: AppCatalog,
  appId: string | null | undefined,
  language: string,
): { name: string; description: string | null; icon: CatalogIcon | null } | null {
  if (appId == null || appId === "") return null;
  const entry = catalog.get(appId);
  if (entry == null) return null;
  return {
    name: entry.name,
    description: localizeCatalogText(entry.description, language),
    icon: entry.icon ?? null,
  };
}
