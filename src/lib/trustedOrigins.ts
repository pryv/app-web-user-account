/**
 * The operator's list of trusted core origins: where the OAuth2 consent page
 * may send credentials, and which access-request poll URLs a restricted
 * deployment accepts besides those its platforms' service info names.
 *
 * Two sources, UNIONED: the build-time `VITE_OAUTH_TRUSTED_API_ORIGINS`
 * (comma-separated) and `trustedApiOrigins` from the deployment's
 * settings.json. Neither is ever taken from the URL. Entries are exact
 * origins (scheme + host + port), or a one-label wildcard
 * `https://*.example.com[:port]` (see originMatch.ts): each is trimmed,
 * normalised, and dropped when it is neither. Match with `originTrusted`.
 *
 * An empty result means "no allowlist configured": the callers then apply
 * their existing rule (fail closed in production, same-registrable-domain
 * fallback in development).
 */

import { trustedOriginEntry } from "./originMatch";
import { getTrustedApiOrigins } from "./deployedSettings";

/** Parse a comma-separated origin list into normalised entries, dropping invalid ones. */
export function parseOriginList(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const item of (raw ?? "").split(",")) {
    const entry = trustedOriginEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

/** Build-time list plus settings.json list, de-duplicated, build-time entries first. */
export function trustedApiOrigins(): string[] {
  const env = parseOriginList(import.meta.env.VITE_OAUTH_TRUSTED_API_ORIGINS as string | undefined);
  return [...new Set([...env, ...getTrustedApiOrigins()])];
}
