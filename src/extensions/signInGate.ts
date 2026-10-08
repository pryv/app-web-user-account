import type { PryvConnection } from "../lib/session";

/**
 * Sign-in gate slot: a page to show after every completed sign-in (password,
 * second factor, third-party provider, fresh registration, and the `/auth`
 * access-request flow, including "Continue as" with a stored session) before
 * the user goes on, for example to ask again for an act after a legal text
 * changed, or for accounts created before the act existed.
 *
 * Return the in-app path of that page (a route the fork adds, see
 * `accountTabs.tsx` `EXTRA_ROUTES`), or null to go on. Anything that is not a
 * path on this app ("/..."), is ignored. The page finishes with
 * `resumeAfterAccountActs(navigate)` (`src/lib/accountActsGate.ts`), which
 * sends the user where the sign-in was going.
 *
 * A throw is logged and the user goes on: to block on a failed check, catch it
 * here and return the page's path.
 *
 * Notes: on `/auth` the inline sign-in is gated only when it stores a session
 * (a second-factor answer that returns a bare token has none to hand over).
 * A sign-in that continues to `/auth` is checked once, by `/auth`. The pending
 * access request is not extended while the user is on your page: keep it short.
 *
 * Never gates here; a fork replaces this file.
 */
export async function pendingAccountActs(_connection: PryvConnection): Promise<string | null> {
  return null;
}
