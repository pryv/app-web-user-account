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
 */

const HANDOFF_ROUTES = new Set(["/cmc-accept", "/cmc-scope-update"]);

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
