/**
 * `?as=<username>` on the access details page (`/account/audit-access/<id>`):
 * a link to an access of an account the signed-in person manages names that
 * account. The page never switches on its own: once the account is found
 * among the ones the person actively manages (listed with their OWN session),
 * it offers "Open as <username>?" and switches only on a click, the way Open
 * on the Delegation page does.
 *
 * The value from the link is only ever COMPARED with that list: it is never
 * sent to the platform before it matched, and an unknown account, one the
 * person does not manage, a pending invite and a stale relationship all give
 * the same answer, so a link cannot probe what exists.
 */

import type { ControlledRecord } from "./pryvClient";
import { isValidUsername, normalizeUsernameInput } from "./username";

/** The query parameter naming the managed account. */
export const AS_PARAM = "as";

/** The raw `as` value of a query string, or null when absent or empty. */
export function asParam(search: string): string | null {
  const value = new URLSearchParams(search).get(AS_PARAM);
  return value == null || value === "" ? null : value;
}

/** `search` without `as` (every other parameter kept), as "?x=1", or "" when nothing is left. */
export function withoutAs(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(AS_PARAM);
  const query = params.toString();
  return query ? "?" + query : "";
}

/** What the page does with `as`. */
export type AsResolution =
  /** Nothing: no `as`, or the account the session already is. */
  | { kind: "none" }
  /** Not a username at all: ignored, and never echoed. */
  | { kind: "ignored" }
  /** An account the person actively manages: offer to open the page as it. */
  | { kind: "offer"; username: string; hostSlug?: string }
  /** Not an account the person actively manages (or none by that name: not told apart). */
  | { kind: "not-managed"; username: string };

/**
 * Resolve `as` against the accounts the signed-in person controls. A value
 * that is not a username is `ignored`; the account the session acts for, or
 * the person's own, is `none`; an ACTIVE controlled account is an `offer`;
 * anything else is `not-managed`. (A listing that failed is the caller's to
 * report: there is no list to pass.)
 */
export function resolveAs(input: {
  as: string | null;
  /** The signed-in person's username, null when it could not be read. */
  selfUsername: string | null;
  /** The account the pages act for, if any. */
  actingUsername: string | null;
  controlled: ControlledRecord[];
}): AsResolution {
  if (input.as == null) return { kind: "none" };
  const username = normalizeUsernameInput(input.as);
  if (!isValidUsername(username)) return { kind: "ignored" };
  if (username === input.actingUsername || username === input.selfUsername) return { kind: "none" };
  const rec = input.controlled.find((r) => r.status === "active" && r.controlled.username === username);
  if (rec == null) return { kind: "not-managed", username };
  const offer: { kind: "offer"; username: string; hostSlug?: string } = { kind: "offer", username };
  if (rec.controlled.hostSlug) offer.hostSlug = rec.controlled.hostSlug;
  return offer;
}
