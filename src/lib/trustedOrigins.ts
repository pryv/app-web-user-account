/**
 * The operator's list of trusted core origins, shared by every page that
 * sends credentials to a core (OAuth2 consent) or delivers a token-bearing
 * result to an origin (CMC approval).
 *
 * Two sources, UNIONED: the build-time `VITE_OAUTH_TRUSTED_API_ORIGINS`
 * (comma-separated) and `trustedApiOrigins` from the deployment's
 * settings.json. Neither is ever taken from the URL. Entries are exact
 * origins (scheme + host + port): each is trimmed, normalised to its origin,
 * and dropped when it is not an absolute http(s) URL. No wildcard or pattern
 * matching.
 *
 * An empty result means "no allowlist configured": the callers then apply
 * their existing rule (fail closed in production, same-registrable-domain
 * fallback in development).
 */

import { httpUrlOrNull } from "./safeRedirect";
import { getTrustedApiOrigins } from "./deployedSettings";

/** Parse a comma-separated origin list into exact origins, dropping invalid entries. */
export function parseOriginList(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const item of (raw ?? "").split(",")) {
    const parsed = httpUrlOrNull(item.trim());
    if (parsed) out.push(parsed.origin);
  }
  return out;
}

/** Build-time list plus settings.json list, de-duplicated, build-time entries first. */
export function trustedApiOrigins(): string[] {
  const env = parseOriginList(import.meta.env.VITE_OAUTH_TRUSTED_API_ORIGINS as string | undefined);
  return [...new Set([...env, ...getTrustedApiOrigins()])];
}
