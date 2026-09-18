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

import type { ControlledRecord } from "@pryv/delegation";

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
 * The choices: the signed-in account first, then every ACTIVE controlled
 * account. Pending and unavailable relationships grant nothing.
 */
export function grantTargets(selfUsername: string, controlled: ControlledRecord[]): GrantTarget[] {
  const targets: GrantTarget[] = [{ username: selfUsername, self: true }];
  for (const rec of controlled) {
    if (rec.status !== "active") continue;
    targets.push({ username: rec.controlled.username, self: false, hostSlug: rec.controlled.hostSlug });
  }
  return targets;
}

/** The choice to preselect: the account the app named, when offered; else the signed-in one. */
export function preselectedTarget(targets: GrantTarget[], actAs: ActAs): GrantTarget {
  if (actAs != null && actAs !== "allow" && actAs !== "deny") {
    const named = targets.find((t) => t.username === actAs);
    if (named) return named;
  }
  return targets[0];
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
