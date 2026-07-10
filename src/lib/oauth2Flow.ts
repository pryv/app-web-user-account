/**
 * Helpers for the OAuth2 (RFC 6749) consent flow served at `/oauth2-authorize`.
 *
 * The core's `GET /oauth2/authorize` validates the client + PKCE parameters,
 * then 302-redirects the browser here with two query parameters:
 *
 *   - `state`   — the signed state: `<base64url(json-payload)>.<base64url(hmac)>`
 *   - `pryvApi` — the API endpoint (issuer) the UI calls back
 *
 * The flow has two external API touchpoints (base = `pryvApi`):
 *
 *   1. POST {pryvApi}/oauth2/authorize/accept — with the signed state, the
 *      user's authenticated session and the granted-scope subset; the server
 *      mints the access and returns the redirect URL (code + client state).
 *   2. POST {pryvApi}/oauth2/authorize/refuse — with the signed state only;
 *      returns the redirect URL carrying `error=access_denied`. No user
 *      session needed — refuse works pre-login (Cancel on the sign-in form).
 *
 * Sign-in itself goes through lib-js `Service.login` (see the route
 * component) — the service-info URL is derived from `pryvApi` below.
 */

import type { LocalizableText, OfferPermission } from "./consent";

// Permission vocabulary + display model live in `lib/consent.ts` (shared by
// every consent surface); re-exported here for the OAuth flow's callers.
export type { LocalizableText, OfferPermission } from "./consent";

/**
 * The consent offer resolved server-side at authorize time and carried
 * in the signed state: the granular permissions the app asks for plus
 * the consent texts to display. Display-only here — the server
 * re-validates the granted subset against its signed copy.
 *
 * `allowUserChoice` defaults to FALSE: the consent is ALL OR NOTHING
 * (every entry locked; the user accepts the whole set or denies). When
 * true, entries may be individually unticked — except `mandatory` ones.
 */
export interface OAuthOffer {
  offerName: string;
  permissions: OfferPermission[];
  allowUserChoice: boolean;
  title: LocalizableText | null;
  description: LocalizableText | null;
  consent: LocalizableText | null;
}

/** Display fields decoded from the signed state payload. */
export interface OAuthState {
  clientId: string;
  redirectUri: string;
  scope: string[];
  offer: OAuthOffer | null;
  userIdHint: string | null;
  iat: number | null;
  exp: number | null;
}

/** Error thrown by accept/refuse carrying the RFC-shaped server response. */
export interface OAuthFlowError extends Error {
  oauthError?: string;
  status?: number;
}

/**
 * Parse the signed OAuth state from the URL into the display fields the
 * consent UI needs (clientId, requested scope, etc.).
 *
 * The state is `<base64url(json-payload)>.<base64url(hmac)>`. We decode the
 * payload for DISPLAY ONLY — never trust it for security (the server
 * re-verifies the signature when we POST to /accept or /refuse). A tampered
 * state will fail at the server with an `invalid_request bad_signature` we
 * render as an error.
 *
 * Throws on malformed input — caller renders an error.
 */
export function parseOAuthState(signedState: string): OAuthState {
  if (typeof signedState !== "string" || signedState.length === 0) {
    throw new Error("parseOAuthState: state is required");
  }
  const dot = signedState.indexOf(".");
  if (dot <= 0 || dot === signedState.length - 1) {
    throw new Error("parseOAuthState: malformed state (missing signature separator)");
  }
  const body = signedState.slice(0, dot);
  const padded =
    body.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (body.length % 4)) % 4);
  let raw: string;
  try {
    raw = atob(padded);
  } catch {
    throw new Error("parseOAuthState: payload is not valid base64");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("parseOAuthState: payload is not valid JSON");
  }
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new Error("parseOAuthState: payload must be a JSON object");
  }
  const p = payload as Record<string, unknown>;
  return {
    clientId: typeof p.clientId === "string" ? p.clientId : "",
    redirectUri: typeof p.redirectUri === "string" ? p.redirectUri : "",
    scope: Array.isArray(p.scope) ? p.scope.filter((s): s is string => typeof s === "string") : [],
    offer: parseOffer(p.offer),
    userIdHint: typeof p.userIdHint === "string" ? p.userIdHint : null,
    iat: typeof p.iat === "number" ? p.iat : null,
    exp: typeof p.exp === "number" ? p.exp : null,
  };
}

function parseOffer(v: unknown): OAuthOffer | null {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.permissions)) return null;
  const permissions = o.permissions.filter(
    (p): p is OfferPermission =>
      typeof p === "object" &&
      p != null &&
      (typeof (p as Record<string, unknown>).streamId === "string" ||
        typeof (p as Record<string, unknown>).feature === "string"),
  );
  if (permissions.length === 0) return null;
  return {
    offerName: typeof o.offerName === "string" ? o.offerName : "",
    permissions,
    allowUserChoice: o.allowUserChoice === true,
    title: asTextMap(o.title),
    description: asTextMap(o.description),
    consent: asTextMap(o.consent),
  };
}

function asTextMap(v: unknown): LocalizableText | null {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>).filter(
    ([, s]) => typeof s === "string",
  ) as [string, string][];
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Service-info URL for the platform `pryvApi` belongs to. Every core serves
 * `/reg/service/info` at its root, so this works for both single-core
 * (dnsLess) and multi-core deployments.
 */
export function serviceInfoUrlFromPryvApi(pryvApi: string): string {
  return pryvApi.replace(/\/$/, "") + "/reg/service/info";
}

/**
 * Guard against consent phishing. `pryvApi` is a query parameter that decides
 * where this page sends the user's password (on sign-in) and personal token
 * (on Accept). An attacker who lures a victim to this trusted consent origin
 * with `?pryvApi=https://attacker` would harvest both — so `pryvApi` must be
 * constrained to a trusted core before we ever call login/accept.
 *
 * Two layers, most-specific first:
 *   1. If the operator configured an allowlist (`trustedOrigins`, from the
 *      `VITE_OAUTH_TRUSTED_API_ORIGINS` build-time env), require an exact
 *      origin match — this is the authoritative, recommended control.
 *   2. Otherwise fall back to requiring `pryvApi` to share the consent UI's own
 *      registrable domain (`selfOrigin`): operators deploy the core and this
 *      app under one parent domain (e.g. `core.example.com` + `app.example.com`),
 *      so an off-platform `attacker.com` is rejected without any config.
 *
 * The registrable-domain fallback is a best-effort convenience and MUST NOT be
 * relied on in production. When `requireAllowlist` is set (the route passes
 * `import.meta.env.PROD`), an unset allowlist fails closed rather than falling
 * back — a production deployment with no configured allowlist is a
 * misconfiguration, not a green light.
 *
 * Always requires https (http only for loopback, for local development).
 * Throws on any violation — the caller renders it as an init error.
 */
export function assertTrustedPryvApi(
  pryvApi: string,
  opts: { trustedOrigins?: string[]; selfOrigin?: string; requireAllowlist?: boolean } = {},
): void {
  let url: URL;
  try {
    url = new URL(pryvApi);
  } catch {
    throw new Error("oauth2: `pryvApi` is not a valid URL.");
  }
  const host = url.hostname;
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("oauth2: refusing insecure `pryvApi` — https is required.");
  }

  const allow = (opts.trustedOrigins ?? []).map((o) => o.trim()).filter(Boolean);
  if (allow.length > 0) {
    if (!allow.includes(url.origin)) {
      throw new Error("oauth2: `pryvApi` origin is not in the trusted allowlist.");
    }
    return;
  }

  // No explicit allowlist configured. In production this is a misconfiguration:
  // fail closed rather than trust the weak registrable-domain fallback.
  if (opts.requireAllowlist) {
    throw new Error(
      "oauth2: no trusted API allowlist is configured — production requires an explicit allowlist.",
    );
  }

  // No explicit allowlist: a loopback core is local development — allow it.
  if (isLoopback) return;

  // Fail closed: with no allowlist AND no self-origin to compare against, there
  // is no trust anchor, so refuse rather than accept an arbitrary host.
  if (!opts.selfOrigin) {
    throw new Error("oauth2: no trusted origin configured for `pryvApi`.");
  }
  let self: URL;
  try {
    self = new URL(opts.selfOrigin);
  } catch {
    throw new Error("oauth2: cannot determine a trusted origin for `pryvApi`.");
  }
  if (registrableDomain(host) !== registrableDomain(self.hostname)) {
    throw new Error(
      "oauth2: `pryvApi` is cross-domain and no trusted allowlist is configured.",
    );
  }
}

/**
 * Best-effort registrable domain (eTLD+1 without a public-suffix list): the
 * last two dot-separated labels. Sufficient for the same-parent-domain
 * fallback; operators on multi-label public suffixes (e.g. `*.co.uk`) or
 * cross-domain deployments should set `VITE_OAUTH_TRUSTED_API_ORIGINS`.
 */
function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  return labels.slice(-2).join(".");
}

/**
 * POST `{pryvApi}/oauth2/authorize/accept` with the signed state, the user's
 * authenticated session, and the granted permission subset (the entries the
 * user kept ticked — validated ⊆ the signed offer by the server). The server
 * establishes the durable consent (data-grant) and mints the session access,
 * then returns the redirect URL the browser should navigate to.
 */
export async function oauth2Accept(opts: {
  pryvApi: string;
  signedState: string;
  username: string;
  personalToken: string;
  grantedPermissions: OfferPermission[];
}): Promise<string> {
  return postOAuth(opts.pryvApi, "/oauth2/authorize/accept", {
    state: opts.signedState,
    username: opts.username,
    userToken: opts.personalToken,
    grantedPermissions: opts.grantedPermissions,
  });
}

/**
 * POST `{pryvApi}/oauth2/authorize/refuse` with the signed state. The server
 * verifies the signature and returns the redirect URL with
 * `error=access_denied`. No access created, no user session needed.
 */
export async function oauth2Refuse(opts: {
  pryvApi: string;
  signedState: string;
}): Promise<string> {
  return postOAuth(opts.pryvApi, "/oauth2/authorize/refuse", { state: opts.signedState });
}

/**
 * Shared POST + response handling: errors are RFC-shaped
 * `{error, error_description}` — surface `error_description || error` as the
 * message and keep `oauthError` + `status` on the thrown error.
 */
async function postOAuth(
  pryvApi: string,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  if (typeof pryvApi !== "string" || pryvApi.length === 0) {
    throw new Error("oauth2: pryvApi is required");
  }
  if (typeof body.state !== "string" || body.state.length === 0) {
    throw new Error("oauth2: signedState is required");
  }
  const url = pryvApi.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
    redirectTo?: string;
  };
  if (!res.ok) {
    const err: OAuthFlowError = new Error(
      json.error_description || json.error || "oauth request failed: HTTP " + res.status,
    );
    err.oauthError = json.error;
    err.status = res.status;
    throw err;
  }
  if (typeof json.redirectTo !== "string" || json.redirectTo.length === 0) {
    throw new Error("oauth2: server response missing redirectTo");
  }
  return json.redirectTo;
}
