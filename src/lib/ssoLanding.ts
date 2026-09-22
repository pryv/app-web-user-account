/**
 * Third-party sign-in (SSO) landing helpers.
 *
 * The core's sign-in callback hands its result back on the URL FRAGMENT
 * (`#ssoStatus=login&ssoUser=…&ssoKey=…`, `#ssoStatus=mfa&…`, or
 * `#ssoError=…`) so nothing SSO-related reaches the landing host's access log
 * or the Referer header. These helpers parse that fragment and build the
 * root-level `/auth/sso/*` URLs; the network + session work lives in the
 * `SsoLanding` route and `SignIn`.
 */

export type SsoOutcome =
  | { kind: "login"; user: string; key: string }
  | { kind: "mfa"; user: string; mfaToken: string; mfaMethod: string | null }
  | { kind: "error"; code: string }
  | { kind: "none" };

/**
 * Parse the callback fragment. Tolerant of a leading `#`. A malformed
 * login/mfa result (missing user or credential) is treated as a generic
 * failure rather than a half-usable state.
 */
export function parseSsoHash(hash: string): SsoOutcome {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const p = new URLSearchParams(raw);
  const err = p.get("ssoError");
  if (err) return { kind: "error", code: err };
  const status = p.get("ssoStatus");
  const user = p.get("ssoUser") ?? "";
  if (status === "login") {
    const key = p.get("ssoKey") ?? "";
    if (!user || !key) return { kind: "error", code: "sso-failed" };
    return { kind: "login", user, key };
  }
  if (status === "mfa") {
    const mfaToken = p.get("ssoMfaToken") ?? "";
    if (!user || !mfaToken) return { kind: "error", code: "sso-failed" };
    return { kind: "mfa", user, mfaToken, mfaMethod: p.get("ssoMfaMethod") };
  }
  return { kind: "none" };
}

/** Map a coarse SSO error code to a user-facing message. */
export function ssoErrorMessage(code: string): string {
  switch (code) {
    case "no-account":
      return "No account is linked to this sign-in yet. Sign in with your password first, or create an account.";
    case "email-not-verified":
      return "Verify this email address in your account before signing in this way.";
    case "sso-failed":
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}

/**
 * Root origin of the core API. SSO is single-core / dnsLess only (the core
 * refuses to boot `sso.enabled` alongside `dns.active`), so the account's
 * per-user API endpoint and the root-level `/auth/sso/*` routes share one
 * origin.
 */
export function coreOriginFromApiEndpoint(apiEndpoint: string): string {
  return new URL(apiEndpoint).origin;
}

/** Public descriptor URL for the configured provider allow-list. */
export function ssoProvidersUrl(coreOrigin: string): string {
  return coreOrigin.replace(/\/+$/, "") + "/auth/sso/providers";
}

/**
 * Where a sign-in button sends the browser to begin a provider flow.
 *
 * `ssoReturn` is an opaque string the core stores and hands back on the landing
 * fragment; build it with `buildSsoReturn`, and never put a credential or the
 * service-info URL in it (the start URL is a GET, logged by the core).
 */
export function ssoStartUrl(
  coreOrigin: string,
  providerId: string,
  ssoReturn?: string | null,
): string {
  const base = coreOrigin.replace(/\/+$/, "") + "/auth/sso/" + encodeURIComponent(providerId) + "/start";
  if (!ssoReturn) return base;
  return base + "?ssoReturn=" + encodeURIComponent(ssoReturn);
}

export interface SsoProvider {
  id: string;
  label?: string;
}

/** Fetch the operator's provider allow-list (id + label). Returns [] on any
 *  failure so the sign-in page degrades to password-only, never an error. */
export async function fetchSsoProviders(coreOrigin: string): Promise<SsoProvider[]> {
  try {
    const res = await fetch(ssoProvidersUrl(coreOrigin), { method: "GET" });
    if (!res.ok) return [];
    const body = (await res.json()) as { providers?: SsoProvider[] };
    return Array.isArray(body.providers) ? body.providers : [];
  } catch {
    return [];
  }
}
