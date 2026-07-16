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
 * Best-effort origin to pin a popup `postMessage` to. Prefers the REAL opener
 * (the `referrer`, i.e. the page that actually opened this popup); falls back
 * to the caller-supplied `returnUrl` only when the referrer is unavailable
 * (e.g. a strict Referrer-Policy). `returnUrl` is caller-controlled, so it is
 * a last-resort PIN HINT, never a trust anchor — token-bearing payloads must
 * be gated separately by an allowlist (`isTrustedResultOrigin`), so a crafted
 * `returnUrl` can pin the message but never harvest the secret. Returns `null`
 * when neither yields a valid http(s) origin.
 */
export function trustedOpenerOrigin(
  returnUrl: string | null | undefined,
  referrer: string | null | undefined,
): string | null {
  return httpUrlOrNull(referrer)?.origin ?? httpUrlOrNull(returnUrl)?.origin ?? null;
}
