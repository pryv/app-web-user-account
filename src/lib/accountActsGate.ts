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

/** For the gate page: go where the sign-in was going, or to the profile. */
export function resumeAfterAccountActs(navigate: NavigateFunction): void {
  const resume = takeAccountActsResume();
  if (resume?.target.kind === "external") {
    window.location.href = resume.target.href;
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
 * straight to `target` (an external target leaves the app).
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
    window.location.href = target.href;
    return;
  }
  navigate(target.path, options);
}
