/**
 * "Back to opening app" affordance.
 *
 * Pages accept `backUrl` + `backLabel` query parameters so the app can render a
 * "← Back to {label}" link and send the user back to the app that opened them.
 *
 * IMPORTANT — this is deliberately NOT named `returnURL`. The auth flow already
 * has a `returnURL` (the completion redirect that carries `state`/`poll`/`code`,
 * i.e. the OAuth2 `redirect_uri` analog). `backUrl` is a separate, user-initiated
 * *cancel / go-back* affordance and must never be conflated with — or override —
 * the auth-completion redirect or an OAuth2 `redirect_uri`.
 *
 * Security: `backUrl` is attacker-controllable, so it MUST be validated against
 * an allowlist of trusted origins before use, to prevent open-redirects. The
 * allowlist comes from the service's trusted-apps configuration; until that is
 * wired in, only same-origin and explicitly-listed origins are accepted.
 */

export interface BackTo {
  url: string | null;
  label: string | null;
}

// TODO: replace with the trusted-apps origin list fetched from service-info.
const ALLOWED_ORIGINS: string[] = [
  typeof window !== "undefined" ? window.location.origin : "",
];

function isAllowed(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return ALLOWED_ORIGINS.includes(parsed.origin);
  } catch {
    return false;
  }
}

/** Parse and validate the back-to params from a query string. */
export function parseBackTo(search: string): BackTo {
  const params = new URLSearchParams(search);
  const rawUrl = params.get("backUrl");
  const label = params.get("backLabel");
  return {
    url: rawUrl && isAllowed(rawUrl) ? rawUrl : null,
    label: label?.trim() || null,
  };
}
