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
 */
export function buildCompletionUrl(
  returnURL: string,
  endpointWithoutToken: string,
  state: string | null,
): string {
  const url = new URL(returnURL);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("pryvApiEndpoint", endpointWithoutToken);
  return url.toString();
}
