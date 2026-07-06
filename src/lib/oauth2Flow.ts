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

/** Display fields decoded from the signed state payload. */
export interface OAuthState {
  clientId: string;
  redirectUri: string;
  scope: string[];
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
    userIdHint: typeof p.userIdHint === "string" ? p.userIdHint : null,
    iat: typeof p.iat === "number" ? p.iat : null,
    exp: typeof p.exp === "number" ? p.exp : null,
  };
}

/**
 * Service-info URL for the platform `pryvApi` belongs to. Every core serves
 * `/reg/service/info` at its root, so this works for both single-core
 * (dnsLess) and multi-core deployments.
 */
export function serviceInfoUrlFromPryvApi(pryvApi: string): string {
  return pryvApi.replace(/\/$/, "") + "/reg/service/info";
}

/** Human label for the well-known scopes; anything else passes through raw. */
export function scopeLabel(scope: string): string {
  if (scope === "pryv:read") return "Read your data";
  if (scope === "pryv:write") return "Create and modify data on your behalf";
  if (scope === "pryv:manage") return "Manage access tokens and account settings";
  return scope;
}

/**
 * POST `{pryvApi}/oauth2/authorize/accept` with the signed state, the user's
 * authenticated session, and the granted-scope subset. The server mints the
 * access (full accesses.create chain) and returns the redirect URL the
 * browser should navigate to.
 */
export async function oauth2Accept(opts: {
  pryvApi: string;
  signedState: string;
  username: string;
  personalToken: string;
  grantedScope: string[];
}): Promise<string> {
  return postOAuth(opts.pryvApi, "/oauth2/authorize/accept", {
    state: opts.signedState,
    username: opts.username,
    userToken: opts.personalToken,
    grantedScope: opts.grantedScope,
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
