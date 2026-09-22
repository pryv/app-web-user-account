/**
 * Where a completed sign-in sends the user.
 *
 * One decision, shared by every way of signing in (password, second factor,
 * third-party provider), so they cannot drift apart. The order is the auth-flow
 * contract:
 *
 *   1. `returnURL` — the calling app asked to be handed control back, so the
 *      browser leaves for it with `state` and the token-less API endpoint.
 *   2. `next` — the user came from an in-app approval hand-off and should land
 *      back on it with the query it carried.
 *   3. otherwise the account profile, keeping `pryvServiceInfoUrl` so the
 *      account section knows which platform it is talking to.
 */

import { parseAuthParams, buildCompletionUrl } from "./authParams";
import { handoffReturnPath } from "./handoffReturn";

export type SignedInTarget =
  | { kind: "external"; href: string }
  | { kind: "internal"; path: string };

export function signedInTarget(search: string, endpointWithoutToken: string): SignedInTarget {
  const { returnURL, serviceInfoUrl, state } = parseAuthParams(search);
  if (returnURL) {
    return { kind: "external", href: buildCompletionUrl(returnURL, endpointWithoutToken, state) };
  }
  const handoff = handoffReturnPath(search);
  if (handoff) return { kind: "internal", path: handoff };
  return {
    kind: "internal",
    path: serviceInfoUrl
      ? "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(serviceInfoUrl)
      : "/account/profile",
  };
}
