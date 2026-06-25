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
}

export function parseAuthParams(search: string): AuthParams {
  const params = new URLSearchParams(search);
  return {
    serviceInfoUrl: params.get("pryvServiceInfoUrl"),
    appId: params.get("requestingAppId") || DEFAULT_APP_ID,
    returnURL: params.get("returnURL"),
  };
}
