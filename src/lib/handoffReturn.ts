/**
 * Return to a hand-off page after signing in.
 *
 * `/cmc-accept` and `/cmc-scope-update` send an unsigned-in user to `/signin`
 * with their own query string plus `next=<route>`. After sign-in (or MFA) the
 * user comes back to that route with the same query string, instead of landing
 * on the account profile and having to reopen the link.
 *
 * `next` is query-supplied, so it is matched EXACTLY against the hand-off
 * routes below: never a URL, never a prefix, so it cannot redirect elsewhere.
 * It is also distinct from `returnURL` (the auth-completion redirect), which
 * keeps precedence.
 *
 * `/auth` reads `next` too: once the access is granted, the window continues to
 * the hand-off page instead of closing (see `chainedHandoffPath`).
 */

/** A hand-off page: one of `HANDOFF_ROUTES`. */
export type HandoffRoute = "/cmc-accept" | "/cmc-scope-update";

export const HANDOFF_ROUTES: ReadonlySet<string> = new Set<HandoffRoute>(["/cmc-accept", "/cmc-scope-update"]);

/** `/signin` link that returns to `route` with the current query string. */
export function signInLinkFor(route: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set("next", route);
  return `/signin?${params.toString()}`;
}

/**
 * The in-app path to return to after sign-in, or null when `next` is absent or
 * not a hand-off route. The returned path carries the query string minus `next`.
 */
export function handoffReturnPath(search: string): string | null {
  const params = new URLSearchParams(search);
  const next = params.get("next");
  if (next == null || !HANDOFF_ROUTES.has(next)) return null;
  params.delete("next");
  const query = params.toString();
  return query ? `${next}?${query}` : next;
}

/** Base the `next` of an access request is resolved against: never navigated to. */
const PLACEHOLDER_ORIGIN = "https://origin.invalid";

/**
 * The hand-off page an access request continues to in the same window once the
 * access is granted (`/auth`'s `next`), or null.
 *
 * Unlike the sign-in return above, `next` here carries the hand-off page's own
 * query: `next=/cmc-accept?capabilityUrl=…&scopeStreamId=…`, URL-encoded as one
 * parameter, so it survives the create-account / reset-password hops on its own
 * and none of the access-request parameters (the poll URL) reach the next page.
 *
 * Query-supplied, so it is held to the same rule: an in-app path whose route is
 * EXACTLY one of the hand-off routes. A URL, a protocol-relative `//host`, a
 * path that normalizes elsewhere (`/cmc-accept/../x`) or any other route gives
 * null. The returned path is the route plus its own query, minus any nested
 * `next` and any fragment.
 */
export function chainedHandoffPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (next == null || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || !HANDOFF_ROUTES.has(url.pathname)) return null;
  url.searchParams.delete("next");
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
