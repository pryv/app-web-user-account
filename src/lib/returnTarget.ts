/**
 * What a page does with a caller-supplied return address once the user has
 * answered: the cross-account hand-offs in redirect mode (`/cmc-accept`,
 * `/cmc-scope-update` `returnUrl`) and `/auth` going back to `backUrl` from a
 * tab.
 *
 * Those addresses come from the link, so anyone can build one. Whether to
 * follow them is the operator's decision, set with `returnPolicy` in
 * settings.json (see deployedSettings.ts): this app's own origin and the
 * listed `trustedOrigins` are always followed; any other origin gets
 * `otherOrigins`: "follow" (the default, no restriction), "confirm" (a link
 * showing the host, which the user clicks) or "stay" (not followed).
 */

import { httpUrlOrNull } from "./safeRedirect";
import { getReturnPolicy, type ReturnAction } from "./deployedSettings";

export interface ReturnDecision {
  action: ReturnAction;
  target: URL;
}

/**
 * How to treat `raw`: null when it is not an absolute http(s) URL (never
 * followed), else the action the operator's policy gives its origin.
 */
export function returnDecision(
  raw: string | null | undefined,
  selfOrigin: string | null = typeof window !== "undefined" ? window.location.origin : null,
): ReturnDecision | null {
  const target = httpUrlOrNull(raw);
  if (!target) return null;
  const policy = getReturnPolicy();
  if ((selfOrigin != null && target.origin === selfOrigin) || policy.trustedOrigins.includes(target.origin)) {
    return { action: "follow", target };
  }
  return { action: policy.otherOrigins, target };
}

/** Leave for `href` (its own function so tests can observe it). */
export function navigateTo(href: string): void {
  window.location.assign(href);
}

/**
 * What a hand-off page does with its outcome: go back to the app (`follow`),
 * offer a link the user clicks (`confirm`), or stay on the page (`stay`).
 */
export type ReturnOutcome =
  | { kind: "follow"; href: string }
  | { kind: "confirm"; href: string; host: string }
  | { kind: "stay" };

/**
 * `returnUrl` with a hand-off's result added (as the `param` query parameter,
 * JSON), and what the operator's return policy says to do with it. `page`
 * names the page in the console line logged when it is not followed.
 */
export function resultReturn(returnUrl: string, param: string, payload: unknown, page: string): ReturnOutcome {
  const decision = returnDecision(returnUrl);
  if (!decision) {
    console.warn(`${page}: returnUrl is not an absolute http(s) URL, staying on the page`);
    return { kind: "stay" };
  }
  decision.target.searchParams.set(param, JSON.stringify(payload));
  if (decision.action === "follow") return { kind: "follow", href: decision.target.toString() };
  if (decision.action === "confirm") {
    return { kind: "confirm", href: decision.target.toString(), host: decision.target.host };
  }
  console.warn(`${page}: the return policy keeps this returnUrl origin on the page:`, decision.target.origin);
  return { kind: "stay" };
}
