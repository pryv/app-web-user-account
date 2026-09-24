/**
 * Parses the query parameters that drive the auth flow.
 *
 * These keep the existing contract so apps that already open the auth page keep
 * working:
 * - `pryvServiceInfoUrl` — which Pryv platform to talk to.
 * - `requestingAppId`    — the app requesting access (used as the login appId).
 * - `returnURL`          — auth-completion redirect (carries state/poll/code).
 *                          Owned by the completion step; NOT the `backUrl`.
 *
 * `backUrl`/`backLabel` (the cancel/"go back" affordance) are parsed separately
 * in `backTo.ts`.
 */

import { assertHttpUrl } from "./safeRedirect";

const DEFAULT_APP_ID = "pryv-user-account";

export interface AuthParams {
  serviceInfoUrl: string | null;
  appId: string;
  /** Auth-completion redirect target (the OAuth2 `redirect_uri` analog). */
  returnURL: string | null;
  /** Calling-app supplied state, reflected back on completion for CSRF protection. */
  state: string | null;
}

export function parseAuthParams(search: string): AuthParams {
  const params = new URLSearchParams(search);
  return {
    serviceInfoUrl: params.get("pryvServiceInfoUrl"),
    appId: params.get("requestingAppId") || DEFAULT_APP_ID,
    returnURL: params.get("returnURL"),
    state: params.get("state"),
  };
}

/**
 * Query params that identify a PENDING ACCESS REQUEST, preserved across the
 * create-account / reset-password / sign-in hops.
 *
 * Only `poll` is load-bearing: `/auth` rebuilds `requestingAppId`,
 * `requestedPermissions` and `returnURL` from the poll state, which the server
 * holds against the request key. The rest are carried for fidelity (platform,
 * language, CLI mode, CSRF state). An allow-list, not the whole query.
 *
 * Deliberately NOT carried:
 * - `requestingAppId`: `/register` and `/signin` read it as the appId they
 *   sign in with, and there the user signs in to this app, not to the
 *   requesting one (which `/auth` reads from the poll state).
 * - `returnURL` and `state`: `/auth` takes them from the poll state too, and
 *   on the other pages they mean the account hand-off. A path that keeps them
 *   but loses `poll` (a third-party sign-in return, say) would hand the user
 *   back to an app still waiting for its access.
 */
const ACCESS_REQUEST_KEYS = [
  "poll",
  "pollUrl",
  "key",
  "serviceInfo",
  "pryvServiceInfoUrl",
  "lang",
  "cli",
  "oauthState",
] as const;

/**
 * Re-serializes the access-request params present in `search`, or "" when
 * there is no pending request (so callers can append it unconditionally).
 */
export function accessRequestSearch(search: string): string {
  if (!hasPendingAccessRequest(search)) return "";
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const k of ACCESS_REQUEST_KEYS) {
    const v = from.get(k);
    if (v != null && v !== "") out.set(k, v);
  }
  return "?" + out.toString();
}

/** True when `search` carries a pending access request (the poll URL). */
export function hasPendingAccessRequest(search: string): boolean {
  const p = new URLSearchParams(search);
  return Boolean(p.get("poll") || p.get("pollUrl"));
}

/**
 * Builds the URL the user is redirected to after a successful sign-in.
 *
 * Contract (intentionally minimal — no long-term secrets in GET):
 * - `state` (when provided by the calling app) — reflected unchanged for CSRF
 *   protection.
 * - `pryvApiEndpoint` — the user's per-account API base **without** the
 *   personal token. The calling app uses this to know which Pryv to talk to;
 *   it must run its own access-request flow to obtain its own token.
 *
 * Token-embedded URLs MUST NOT appear here — GET parameters end up in browser
 * history, server access logs, and Referer headers.
 *
 * `returnURL` is query-supplied and fully attacker-controllable, so it is
 * validated as an absolute http(s) URL first: a `javascript:`/`data:` scheme
 * parses fine through `new URL(...)` and would execute in the auth origin when
 * the result is assigned to `window.location.href`. Throws (fail-closed — no
 * navigation) on any non-http(s) scheme or invalid URL.
 */
export function buildCompletionUrl(
  returnURL: string,
  endpointWithoutToken: string,
  state: string | null,
): string {
  const url = assertHttpUrl(returnURL);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("pryvApiEndpoint", endpointWithoutToken);
  return url.toString();
}
