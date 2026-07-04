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
 * Security: `backUrl` is attacker-controllable. It is restricted to
 * http(s) URLs (no `javascript:`/`data:` schemes), and the rendered link
 * always displays the target HOST next to the label, so a link to an
 * unexpected site is visible to the user instead of looking endorsed by
 * this page. It is a plain navigation the user chooses to click — it never
 * carries tokens and never overrides the auth-completion redirect.
 */

export interface BackTo {
  url: string | null;
  label: string | null;
  /** Host of `url`, displayed next to the label (anti-phishing cue). */
  host: string | null;
}

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : undefined;
    const parsed = new URL(rawUrl, base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Parse and validate the back-to params from a query string. */
export function parseBackTo(search: string): BackTo {
  const params = new URLSearchParams(search);
  const rawUrl = params.get("backUrl");
  const label = params.get("backLabel");
  const parsed = rawUrl ? parseHttpUrl(rawUrl) : null;
  return {
    url: parsed ? parsed.toString() : null,
    label: label?.trim() || null,
    host: parsed ? parsed.host : null,
  };
}
