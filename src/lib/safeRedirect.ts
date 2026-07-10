/**
 * Redirect-target safety helpers shared by every surface that hands control
 * back to another origin (OAuth consent redirect, cross-account approval
 * hand-offs). A server- or query-supplied target must never be navigated to
 * blindly: a `javascript:` / `data:` URL returned by a compromised or buggy
 * peer would execute in the trusted consent origin. These helpers constrain
 * such targets to absolute http(s) URLs before they reach
 * `window.location.assign` or `window.opener.postMessage`.
 */

/**
 * Parse `raw` and require an absolute `http:`/`https:` URL. Throws when the
 * value is not a valid absolute URL (relative paths have no scheme and fail
 * here) or carries any other scheme (`javascript:`, `data:`, `file:`, …).
 */
export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Refusing an invalid redirect target — an absolute http(s) URL is required.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Refusing a redirect target that is not an http(s) URL.");
  }
  return url;
}

/** Non-throwing variant: returns the parsed http(s) URL, or `null` otherwise. */
export function httpUrlOrNull(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    return assertHttpUrl(raw);
  } catch {
    return null;
  }
}

/**
 * Best-effort trustworthy origin to pin a popup `postMessage` to. Prefers the
 * caller-supplied `returnUrl` origin; falls back to the opener's `referrer`
 * origin. Returns `null` when neither yields a valid http(s) origin — callers
 * must then refuse to broadcast token-bearing payloads to `'*'`.
 */
export function trustedOpenerOrigin(
  returnUrl: string | null | undefined,
  referrer: string | null | undefined,
): string | null {
  return httpUrlOrNull(returnUrl)?.origin ?? httpUrlOrNull(referrer)?.origin ?? null;
}
