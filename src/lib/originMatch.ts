/**
 * Trusted API origin entries: an exact origin, or a one-label wildcard.
 *
 * - `https://core.example.com[:port]` (or `http://` on loopback, where the
 *   caller allows it): that origin exactly.
 * - `https://*.example.com[:port]`: every origin one label under
 *   `example.com` on that scheme and port (`https://alice.example.com`),
 *   never `example.com` itself and never two labels down
 *   (`https://a.b.example.com`). https only, at least two labels after `*.`
 *   (never a top-level domain), no IP address. This is what a platform with
 *   per-user hosts (`https://{username}.example.com/`) needs: the consent page
 *   then talks to the account's own host. There is no public-suffix list: an
 *   entry like `https://*.co.uk` or `https://*.github.io` is accepted and
 *   trusts every site under it, so an operator lists only a domain they control.
 *
 * `*` anywhere else is no wildcard and the entry is dropped. Entries are
 * normalised (lower-case, punycode, default port dropped) so the match is a
 * string comparison on parsed hosts.
 */

import { httpUrlOrNull } from "./safeRedirect";

const WILDCARD_PREFIX = "https://*.";
const IPV4 = /^[0-9.]+$/;

/** The normalised entry, or null when `raw` is neither an origin nor a valid wildcard. */
export function trustedOriginEntry(raw: string): string | null {
  const s = raw.trim();
  if (s.slice(0, WILDCARD_PREFIX.length).toLowerCase() === WILDCARD_PREFIX) {
    const rest = s.slice(WILDCARD_PREFIX.length).replace(/\/$/, "");
    if (rest === "" || /[/?#@*\\\s]/.test(rest)) return null;
    // Parse with a stand-in label, so the URL parser normalises the domain and port.
    const u = httpUrlOrNull("https://x." + rest);
    if (!u || u.username || u.password || !u.hostname.startsWith("x.")) return null;
    const domain = u.hostname.slice(2);
    if (domain.split(".").length < 2 || domain.split(".").some((l) => l === "")) return null;
    if (IPV4.test(domain) || domain.includes("[") || domain.includes(":")) return null;
    if (u.port === "0") return null;
    return WILDCARD_PREFIX + domain + (u.port ? ":" + u.port : "");
  }
  const parsed = httpUrlOrNull(s);
  if (!parsed || parsed.hostname.includes("*")) return null;
  return parsed.origin;
}

/** Whether `origin` (an absolute URL or origin) is one of `entries` (normalised, see `trustedOriginEntry`). */
export function originTrusted(origin: string, entries: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.startsWith(WILDCARD_PREFIX)) {
      if (u.protocol !== "https:") continue;
      const rest = entry.slice(WILDCARD_PREFIX.length);
      const colon = rest.lastIndexOf(":");
      const domain = colon >= 0 ? rest.slice(0, colon) : rest;
      const port = colon >= 0 ? rest.slice(colon + 1) : "";
      if (u.port !== port || !u.hostname.endsWith("." + domain)) continue;
      const label = u.hostname.slice(0, -(domain.length + 1));
      if (label.length > 0 && !label.includes(".")) return true;
    } else if (entry === u.origin) {
      return true;
    }
  }
  return false;
}
