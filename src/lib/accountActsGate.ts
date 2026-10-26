/**
 * The plumbing around the operator's sign-in gate (`src/extensions/signInGate.ts`).
 *
 * After a completed sign-in, the gate may name a page to show first. Where the
 * sign-in was going is then kept in this tab's sessionStorage, never in the
 * URL: a resume target carried by a link would let anyone send a user who just
 * signed in anywhere. The gate page calls `resumeAfterAccountActs` when done.
 */

import type { NavigateFunction } from "react-router-dom";
import { pendingAccountActs } from "../extensions/signInGate";
import { loggableError } from "./apiError";
import { httpUrlOrNull } from "./safeRedirect";
import { navigateTo, returnDecision, type ReturnOutcome } from "./returnTarget";
import type { PryvConnection } from "./session";
import type { SignedInTarget } from "./signInCompletion";

const RESUME_KEY = "pryv.accountActs.resume";

/** Where a gated sign-in was going, with the navigation options it would have used. */
export interface AccountActsResume {
  target: SignedInTarget;
  replace?: boolean;
  state?: unknown;
}

/** A path on this app ("/...", not "//host"), or null. */
function inAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/**
 * Ask the operator's gate. When it names a page, remember `resume` and return
 * the page's path; otherwise (nothing pending, an invalid answer, or a failed
 * check) return null and the caller goes on.
 */
export async function accountActsGate(connection: PryvConnection, resume: AccountActsResume): Promise<string | null> {
  let path: string | null;
  try {
    path = inAppPath(await pendingAccountActs(connection));
  } catch (err: unknown) {
    console.warn("sign-in gate: the pending-acts check failed, continuing:", loggableError(err));
    return null;
  }
  try {
    // Only the current detour's target is ever kept: a page abandoned earlier
    // must not leave a target for a later visit.
    if (path == null) sessionStorage.removeItem(RESUME_KEY);
    else sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume));
  } catch {
    // No storage: the gate page will fall back to the profile.
  }
  return path;
}

/** Read and clear the remembered target (null when none, or not a valid one). */
export function takeAccountActsResume(): AccountActsResume | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as AccountActsResume;
    const t = parsed?.target;
    if (t?.kind === "external" && httpUrlOrNull(t.href)) return parsed;
    if (t?.kind === "internal" && inAppPath(t.path)) return parsed;
  } catch {
    // Unreadable: treated as absent.
  }
  return null;
}

/** Router state key of the notice the account pages show when `returnURL` was not followed. */
const SIGNIN_RETURN_STATE = "signInReturn";

/**
 * Leave for an external target (`returnURL`) as the operator's return policy
 * says (returnTarget.ts), like every other hand-off: this app's origin and
 * the trusted origins are followed; otherwise the user stays on the account,
 * which shows a link with the host (`confirm`) or a short notice (`stay`).
 */
function leaveSignedIn(
  target: Extract<SignedInTarget, { kind: "external" }>,
  navigate: NavigateFunction,
  replace: boolean | undefined,
): void {
  const decision = returnDecision(target.href);
  if (decision?.action === "follow") {
    navigateTo(decision.target.toString());
    return;
  }
  let outcome: ReturnOutcome;
  if (decision?.action === "confirm") {
    outcome = { kind: "confirm", href: decision.target.toString(), host: decision.target.host };
  } else {
    console.warn("sign-in: the return policy keeps this returnURL on the account:", target.href);
    outcome = { kind: "stay" };
  }
  navigate(inAppPath(target.stayPath) ?? "/account/profile", {
    replace,
    state: { [SIGNIN_RETURN_STATE]: outcome },
  });
}

/**
 * The notice an account page shows after a sign-in whose `returnURL` was not
 * followed (read from the router state `leaveSignedIn` set), or null.
 */
export function signInReturnOutcome(state: unknown): ReturnOutcome | null {
  if (state == null || typeof state !== "object") return null;
  const outcome = (state as Record<string, unknown>)[SIGNIN_RETURN_STATE] as
    | { kind?: unknown; href?: unknown }
    | null
    | undefined;
  if (outcome?.kind === "stay") return { kind: "stay" };
  if (outcome?.kind === "confirm") {
    const url = httpUrlOrNull(typeof outcome.href === "string" ? outcome.href : null);
    // The host shown is always the link's own.
    if (url) return { kind: "confirm", href: url.toString(), host: url.host };
  }
  return null;
}

/** For the gate page: go where the sign-in was going, or to the profile. */
export function resumeAfterAccountActs(navigate: NavigateFunction): void {
  const resume = takeAccountActsResume();
  if (resume?.target.kind === "external") {
    leaveSignedIn(resume.target, navigate, resume.replace ?? true);
    return;
  }
  navigate(resume?.target.kind === "internal" ? resume.target.path : "/account/profile", {
    replace: resume?.replace ?? true,
    state: resume?.state,
  });
}

/** `/auth` asks the gate itself once the request continues: no second check on the way there. */
function gatesItself(target: SignedInTarget): boolean {
  return target.kind === "internal" && /^\/auth(\?|#|$)/.test(target.path);
}

/**
 * Finish a completed sign-in: through the gate's page when it names one, else
 * straight to `target` (an external target leaves the app as the operator's
 * return policy says, see `leaveSignedIn`).
 */
export async function continueSignedIn(
  connection: PryvConnection,
  target: SignedInTarget,
  navigate: NavigateFunction,
  options: { replace?: boolean; state?: unknown } = {},
): Promise<void> {
  const gate = gatesItself(target) ? null : await accountActsGate(connection, { target, ...options });
  if (gate) {
    navigate(gate, { replace: options.replace });
    return;
  }
  if (target.kind === "external") {
    leaveSignedIn(target, navigate, options.replace);
    return;
  }
  navigate(target.path, options);
}
