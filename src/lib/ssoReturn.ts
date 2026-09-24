/**
 * Remember where the user came from across a third-party sign-in.
 *
 * Signing in with a provider leaves this app entirely: the browser goes to the
 * core, on to the identity provider, and comes back to the landing page, which
 * the operator configures as a single fixed URL. Without help, everything the
 * calling app sent us (`returnURL`, `state`, `requestingAppId`, or the `next`
 * of an approval hand-off) is gone by the time we are back, and the user lands
 * on the account profile instead of wherever they were headed.
 *
 * Two layers carry it, because neither alone is enough:
 *
 * 1. **Through the core.** `/auth/sso/<provider>/start` takes an opaque
 *    `ssoReturn` string, keeps it in its signed one-shot state cookie, and
 *    hands it back on the landing fragment once that cookie verifies. This
 *    survives a callback that lands in a different browsing context (a native
 *    identity broker returning through a new tab), which is why it is the
 *    guarantee. It carries an ALLOW-LISTED, non-secret subset only: the start
 *    URL is a GET and ends up in the core's request log.
 *
 * 2. **In this tab.** The full query is stashed in `sessionStorage` under a
 *    random nonce that also travels in the subset. When the user comes back to
 *    the same tab we restore everything, which is what makes an approval
 *    hand-off work: its `capabilityUrl` is a bearer token and must never ride
 *    through the core. Best effort by nature (other tab, storage blocked,
 *    expired), so the subset is the fallback.
 *
 * Whatever comes back, `pryvServiceInfoUrl` is always taken from the landing
 * page's own query and never from the restored context: it decides which core
 * the one-time sign-in key is redeemed against, so letting a crafted start link
 * choose it would hand the session to an attacker's service.
 */

import { httpUrlOrNull } from "./safeRedirect";
import { safeReturnTo } from "./session";

/**
 * The only keys that ride through the core. Never a credential: that is why a
 * pending access request's `poll` is NOT here (once the request is accepted,
 * whoever holds the poll URL can read the app's token), so it survives through
 * the same-tab stash only. `returnTo` is safe because `safeReturnTo` limits it
 * to account pages, whose query carries nothing secret. `backUrl` / `backLabel`
 * deliberately stay out: through the core they would let a crafted start link
 * plant a back link after sign-in; they survive through the same-tab stash.
 */
const RETURN_KEYS = ["returnURL", "state", "requestingAppId", "next", "returnTo"] as const;

/** Matches the core's own bound on `ssoReturn`; over it we fall back to the stash. */
const MAX_RETURN_CHARS = 2048;

const STASH_KEY = "pryv.sso.return";

/** Mirrors the core state cookie's 10-minute life. */
const STASH_TTL_MS = 600_000;

/** Never restored from the return context: the landing page's own query wins. */
const TRUST_ANCHOR_KEY = "pryvServiceInfoUrl";

interface Stash {
  h: string;
  search: string;
  at: number;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build the opaque return context for the start URL, plus the nonce that ties
 * it to this tab's stash.
 *
 * `value` is null when there is nothing worth carrying, or when the subset
 * would exceed what the core accepts — in both cases the stash still works, so
 * a same-tab return loses nothing.
 */
export function buildSsoReturn(search: string): { value: string | null; nonce: string } {
  const nonce = randomNonce();
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of RETURN_KEYS) {
    const raw = from.get(key);
    if (raw == null || raw === "") continue;
    // A returnURL that is not an absolute http(s) URL can never be navigated
    // to, so it is dropped here rather than on the way back.
    if (key === "returnURL" && httpUrlOrNull(raw) == null) continue;
    if (key === "returnTo" && safeReturnTo(raw) == null) continue;
    out.set(key, raw);
  }
  if ([...out.keys()].length === 0) return { value: null, nonce };
  out.set("h", nonce);
  const value = out.toString();
  return { value: value.length > MAX_RETURN_CHARS ? null : value, nonce };
}

/**
 * Keep the full query in this tab for the duration of the round-trip. Storage
 * can be unavailable or full; a failure here only costs fidelity on return.
 */
export function stashSsoReturn(nonce: string, search: string, now: number = Date.now()): void {
  try {
    const stash: Stash = { h: nonce, search, at: now };
    sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
  } catch {
    // Best effort: the core-carried subset remains.
  }
}

/** Read the stash and consume it: a return context is used once. */
function takeStash(): Stash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<Stash>;
    if (typeof parsed?.h !== "string" || typeof parsed.search !== "string" ||
        typeof parsed.at !== "number") {
      return null;
    }
    return { h: parsed.h, search: parsed.search, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Rebuild the query to finish the sign-in with, merging what came back into the
 * landing page's own query. The landing page's values win on conflict, which is
 * what pins `pryvServiceInfoUrl` to the operator-configured core.
 */
export function restoreSsoReturn(
  ssoReturn: string | null,
  landingSearch: string,
  now: number = Date.now(),
): string {
  const stash = takeStash();

  // Everything that came back through the core is re-filtered to the same
  // allow-list it should have been built from. Our own builder never sends
  // anything else, so this costs nothing and means a crafted start link cannot
  // introduce a key we never intended to carry.
  const returned = new URLSearchParams(ssoReturn ?? "");
  const nonce = returned.get("h");
  const subset = new URLSearchParams();
  for (const key of RETURN_KEYS) {
    const value = returned.get(key);
    if (value != null) subset.set(key, value);
  }

  // The stash is the full-fidelity copy, usable when it is this tab's, fresh,
  // and matches the context we got back.
  //
  // `ssoReturn` being null does not only mean an older core that does not echo
  // it: our own builder also sends nothing when the subset would be oversize or
  // when there was nothing allow-listed to carry, so this rule is what makes
  // that designed fallback work against a CURRENT core too. The bounded
  // consequence is that a fresh (under 10 min) stash from an earlier abandoned
  // attempt in this tab is applied to a later context-less landing; that stash
  // is the user's own earlier sign-in query, so it is no worse than them having
  // followed that link again.
  const stashUsable = stash != null &&
    now - stash.at < STASH_TTL_MS &&
    (ssoReturn == null || stash.h === nonce);

  const full = stashUsable ? new URLSearchParams(stash.search) : subset;
  full.delete(TRUST_ANCHOR_KEY);

  const returnURL = full.get("returnURL");
  if (returnURL != null && httpUrlOrNull(returnURL) == null) full.delete("returnURL");
  const returnTo = full.get("returnTo");
  if (returnTo != null && safeReturnTo(returnTo) == null) full.delete("returnTo");

  const merged = new URLSearchParams(landingSearch);
  for (const [key, value] of full) {
    if (!merged.has(key)) merged.set(key, value);
  }
  const query = merged.toString();
  return query ? `?${query}` : "";
}

/**
 * The `ssoReturn` the core echoed on the landing fragment, or null. Kept out of
 * `parseSsoHash` so the sign-in outcome shape stays untouched.
 */
export function ssoReturnFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw).get("ssoReturn");
}
