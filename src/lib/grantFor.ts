/**
 * "Who is this access for?" in the auth popup.
 *
 * A signed-in user who controls other accounts (account delegation) may
 * grant the requesting app access on one of those accounts instead of their
 * own. The popup then works on the controlled account with a delegate token
 * that it obtains for the purpose and keeps in memory only: it is never
 * stored, never made the page's session and never posted back to the app.
 * The app receives an ordinary app access on the controlled account.
 */

import type { ControlledRecord } from "./pryvClient";

/** One choice of the selector. */
export interface GrantTarget {
  username: string;
  /** The signed-in account itself. */
  self: boolean;
  /** Core of a controlled account (display + the delegation hint). */
  hostSlug?: string;
}

/** The access-state field an app sets to steer the selector. */
export type ActAs = "allow" | "deny" | string | undefined;

/**
 * Whether to offer the selector at all: the platform must run delegation and
 * the app must not have asked for the signed-in account only.
 */
export function offersTargets(
  serviceInfo: { features?: { delegation?: unknown } } | null | undefined,
  actAs: ActAs,
): boolean {
  return serviceInfo?.features?.delegation === true && actAs !== "deny";
}

/**
 * Whether the app named who the access may be for (`actAs` sent: `"allow"` or
 * a username). The core echoes `actAs` only when the request sent it, so a
 * request that says nothing reads as absent here. Only then does the step show
 * with a single choice and offer to create an account for someone the user
 * looks after: apps that never serve managed accounts gain no step.
 */
export function namesActAs(actAs: ActAs | null): boolean {
  return typeof actAs === "string" && actAs !== "" && actAs !== "deny";
}

/**
 * Whether the app asked that the access be granted for an account the user
 * manages, never the signed-in one (`actAsManagedOnly: true` on the poll
 * state). A core that does not know the field drops it and does not echo it:
 * the page then behaves per `actAs`. Anything but `true` reads as not asked.
 */
export function managedOnlyOf(state: { actAsManagedOnly?: unknown } | null | undefined): boolean {
  return state?.actAsManagedOnly === true;
}

/** `reasonId` of the REFUSED answer when the app needs a managed account and none can be used here. */
export const MANAGED_ACCOUNT_UNAVAILABLE = "MANAGED_ACCOUNT_UNAVAILABLE";

/**
 * The choices: the signed-in account first, then every ACTIVE controlled
 * account. Pending and unavailable relationships grant nothing. With
 * `managedOnly`, the signed-in account is not offered.
 */
export function grantTargets(
  selfUsername: string,
  controlled: ControlledRecord[],
  options: { managedOnly?: boolean } = {},
): GrantTarget[] {
  const targets: GrantTarget[] = options.managedOnly === true ? [] : [{ username: selfUsername, self: true }];
  for (const rec of controlled) {
    if (rec.status !== "active") continue;
    targets.push({ username: rec.controlled.username, self: false, hostSlug: rec.controlled.hostSlug });
  }
  return targets;
}

/**
 * The choice to preselect: the account the app named, when offered; else
 * `preferred` (the account the account pages were acting for), when offered;
 * else the signed-in one, when offered (not with `managedOnly`): else none,
 * and the user picks.
 */
export function preselectedTarget(targets: GrantTarget[], actAs: ActAs, preferred?: string | null): GrantTarget | null {
  if (actAs != null && actAs !== "allow" && actAs !== "deny") {
    const named = targets.find((t) => t.username === actAs);
    if (named) return named;
  }
  if (preferred != null) {
    const acting = targets.find((t) => t.username === preferred && !t.self);
    if (acting) return acting;
  }
  return targets.find((t) => t.self) ?? null;
}

/**
 * The account the app named in `actAs` when it is not among the choices (the
 * user does not control it, or not actively), so the screen can say why it
 * was not preselected; `null` otherwise.
 */
export function unavailableActAs(targets: GrantTarget[], actAs: ActAs): string | null {
  if (actAs == null || actAs === "allow" || actAs === "deny" || actAs === "") return null;
  return targets.some((t) => t.username === actAs) ? null : actAs;
}

/**
 * Whether the step offers to create an account for someone the user looks
 * after: when the app named `actAs` or asked for a managed account, and never
 * from a session acting for another account (the new account's delegate is
 * the user).
 */
export function offersCreation(actAs: ActAs | null, managedOnly: boolean, acting: boolean): boolean {
  return (managedOnly || namesActAs(actAs)) && !acting;
}

/** Why no managed account can be used, when the app asked for one. */
export type ManagedUnavailableCause = "delegation-off" | "info-unreadable" | "list-failed" | "none";

/** What follows the sign-in: see `grantStep`. */
export type GrantStep =
  /** Straight to the consent step, for the signed-in account. */
  | { kind: "consent" }
  /** "Who is this for?". `selected` null: nothing preselected, Continue waits for a choice. */
  | { kind: "choose"; targets: GrantTarget[]; selected: string | null; listFailed: boolean; createOpen: boolean }
  /** The app asked for a managed account and none can be used: the user can only cancel. */
  | { kind: "unavailable"; cause: ManagedUnavailableCause };

/**
 * What follows the sign-in.
 * - `offers`: `offersTargets` for the platform's service info, or null when
 *   that info could not be read.
 * - `listed`: the accounts the user controls, or null when they could not be
 *   listed (or were not, because nothing is offered).
 * - `acting`: the session acts for another account (`preferred`, when the
 *   pages were acting for it).
 *
 * Without `managedOnly` (the step as before): shown when the user controls an
 * active account, or when the app named `actAs` (for the creation offer, even
 * after a failed listing); else the consent step for the signed-in account.
 *
 * With `managedOnly`, the signed-in account is never a choice: the step lists
 * the active managed accounts, preselected as `preselectedTarget` says (else
 * nothing); with none, the creation form opens directly. When no managed
 * account can be used (delegation not offered, a listing that failed or found
 * none without the creation offer), the answer is `unavailable`, never the
 * signed-in account.
 */
export function grantStep(input: {
  offers: boolean | null;
  listed: ControlledRecord[] | null;
  selfUsername: string;
  actAs: ActAs | null;
  managedOnly: boolean;
  acting: boolean;
  preferred?: string | null;
}): GrantStep {
  const { offers, listed, selfUsername, actAs, managedOnly, acting, preferred } = input;
  if (offers !== true) {
    if (!managedOnly) return { kind: "consent" };
    return { kind: "unavailable", cause: offers == null ? "info-unreadable" : "delegation-off" };
  }
  const creation = offersCreation(actAs, managedOnly, acting);
  if (listed == null && !creation) return managedOnly ? { kind: "unavailable", cause: "list-failed" } : { kind: "consent" };
  const targets = grantTargets(selfUsername, listed ?? [], { managedOnly });
  if (managedOnly) {
    if (targets.length === 0 && !creation) return { kind: "unavailable", cause: "none" };
  } else if (targets.length < 2 && !creation) {
    return { kind: "consent" };
  }
  const prefill = creationPrefill(targets, actAs ?? undefined, selfUsername);
  return {
    kind: "choose",
    targets,
    selected: preselectedTarget(targets, actAs ?? undefined, preferred)?.username ?? null,
    listFailed: listed == null,
    // Open at once when the app named an account the user does not manage
    // yet, or when there is nothing else to choose.
    createOpen: creation && (prefill != null || targets.length === 0),
  };
}

/**
 * The username to pre-fill the creation form with: the account the app named
 * when it is not among the choices (`unavailableActAs`), unless it is the
 * signed-in account itself (not a choice with `managedOnly`, and taken).
 */
export function creationPrefill(targets: GrantTarget[], actAs: ActAs, selfUsername: string): string | null {
  const named = unavailableActAs(targets, actAs);
  return named != null && named !== selfUsername ? named : null;
}

/** The display hint posted with ACCEPTED when the access was granted on a controlled account. */
export interface DelegationHint {
  isDelegatedAccess: true;
  controlledUsername: string;
  delegate: { username: string; hostSlug?: string };
}

export function delegationHint(controlledUsername: string, delegate: { username: string; hostSlug?: string }): DelegationHint {
  const hint: DelegationHint = {
    isDelegatedAccess: true,
    controlledUsername,
    delegate: { username: delegate.username },
  };
  if (delegate.hostSlug) hint.delegate.hostSlug = delegate.hostSlug;
  return hint;
}

/**
 * Whether an app access was granted through a delegation, read from the
 * server-set lineage marker. An access the account owner granted carries none,
 * and must not be described to the app as delegated.
 */
export function isDelegatedChild(access: { clientData?: Record<string, unknown> | null } | null | undefined): boolean {
  const marker = access?.clientData?.delegation as { kind?: unknown } | undefined;
  return marker?.kind === "delegated-child";
}

/**
 * The hint for an access that carries the delegation lineage marker, read
 * from the marker itself: the grant may have gone through a session that was
 * already acting for the controlled account, without the selector.
 */
export function hintForAccess(
  access: { clientData?: Record<string, unknown> | null } | null | undefined,
  controlledUsername: string,
): DelegationHint | undefined {
  if (!isDelegatedChild(access)) return undefined;
  const marker = access?.clientData?.delegation as { delegate?: { username?: unknown } };
  if (typeof marker.delegate?.username !== "string") return undefined;
  return delegationHint(controlledUsername, { username: marker.delegate.username });
}

/** Working credentials on the controlled account: its API endpoint and a delegate token. */
export interface DelegatedWorkspace {
  username: string;
  apiEndpoint: string;
  token: string;
}

/**
 * Obtain a delegate token for a controlled account. Only the returned object
 * holds it; callers keep it in memory and drop it when the flow ends.
 */
export async function openDelegatedWorkspace(
  client: { getToken(username: string): Promise<{ token: string; apiEndpoint: string }> },
  username: string,
): Promise<DelegatedWorkspace> {
  const { token, apiEndpoint } = await client.getToken(username);
  return { username, token, apiEndpoint: endpointWithoutToken(apiEndpoint) };
}

/** Strip a `token@` userinfo part from an API endpoint. */
export function endpointWithoutToken(apiEndpoint: string): string {
  try {
    const url = new URL(apiEndpoint);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return apiEndpoint;
  }
}

// ------------------------------------------------------------------ re-open

const DONE_PREFIX = "pryv.auth.done:";

/**
 * Remember, for this browser tab, that the request behind `pollUrl` was
 * decided here. A later reload, once the server has forgotten the request,
 * then reads as "done" rather than as an unknown request.
 */
export function markRequestDone(pollUrl: string): void {
  try {
    sessionStorage.setItem(DONE_PREFIX + pollUrl, "1");
  } catch {
    // sessionStorage may be unavailable (private mode): the reload then
    // shows the generic error, as before.
  }
}

export function wasRequestDone(pollUrl: string): boolean {
  try {
    return sessionStorage.getItem(DONE_PREFIX + pollUrl) === "1";
  } catch {
    return false;
  }
}
