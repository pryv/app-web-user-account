/**
 * Group memberships, administrator side (`/account/memberships`).
 *
 * A group (a practice, a research team) is an ordinary account. A member is
 * another account that asked to join it: the member hands a membership
 * request link (a capability URL, as a QR code or a link) to an
 * administrator, who opens it here and approves it for some or all of the
 * teams it names, with this account's own session or a delegate's. The access
 * the platform then creates on this account is the membership; ending it
 * removes the accesses the member was given on other accounts through the
 * group (an offboarding sweep, followed below the members list).
 *
 * Pure helpers, kept apart from the page so the wording and the mapping are
 * unit-testable.
 */

import i18n from "../i18n";
import { cmcErrorIds as errorIds } from "./pryvClient";
import { inviteFailure } from "./cmcAccept";
import { platformError } from "./apiError";

/** Prefix of the streams a group's teams live under. */
const APPS_PREFIX = ":_cmc:apps:";

/** Plugin-managed leaves under an app scope: never a team. */
const PLUGIN_SEGMENTS = new Set(["chats", "collectors"]);

/**
 * A team stream: `:_cmc:apps:<app>[:<path>]`, outside the plugin's own
 * `chats` and `collectors` streams (the rule the platform applies to what a
 * membership may ask for).
 */
export function isTeamStream(streamId: unknown): streamId is string {
  if (typeof streamId !== "string" || !streamId.startsWith(APPS_PREFIX)) return false;
  const segments = streamId.slice(APPS_PREFIX.length).split(":");
  if (segments.some((s) => s === "")) return false;
  return !segments.slice(1).some((s) => PLUGIN_SEGMENTS.has(s));
}

/**
 * The capability URL in what the administrator pasted: the member's link
 * itself, or a link to this page (or to `/cmc-accept`) carrying it as
 * `capabilityUrl` (or `capability`). Null when it is neither.
 */
export function capabilityUrlFromInput(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const carried = url.searchParams.get("capabilityUrl") ?? url.searchParams.get("capability");
  if (carried != null) return capabilityUrlFromInput(carried);
  // A capability URL carries its token: without one it cannot be read.
  if (url.username === "") return null;
  return text;
}

/**
 * Where the approval (or the refusal) is recorded on this account: the app
 * stream the requested teams belong to (`:_cmc:apps:<app>`), or null when the
 * request names no team.
 */
export function acceptScopeFor(permissions: ReadonlyArray<{ streamId?: unknown }>): string | null {
  for (const p of permissions) {
    if (!isTeamStream(p.streamId)) continue;
    const app = p.streamId.slice(APPS_PREFIX.length).split(":")[0];
    return APPS_PREFIX + app;
  }
  return null;
}

/** The team streams a request asks for, in its order, without duplicates. */
export function requestedTeams(permissions: ReadonlyArray<{ streamId?: unknown }>): string[] {
  const out: string[] = [];
  for (const p of permissions) {
    if (isTeamStream(p.streamId) && !out.includes(p.streamId)) out.push(p.streamId);
  }
  return out;
}

/** Display names of this account's streams, by id. */
export type StreamNames = ReadonlyMap<string, string>;

/** Flatten a `streams.get` tree into id → name. */
export function streamNamesOf(streams: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (s == null || typeof s !== "object") continue;
      const { id, name, children } = s as { id?: unknown; name?: unknown; children?: unknown };
      if (typeof id === "string" && typeof name === "string" && name !== "") names.set(id, name);
      walk(children);
    }
  };
  walk(streams);
  return names;
}

/** A team as shown: its stream's name, else the last part of its id. */
export function teamName(streamId: string, names?: StreamNames | null): string {
  const named = names?.get(streamId);
  if (named) return named;
  const parts = streamId.split(":");
  return parts[parts.length - 1] || streamId;
}

/** An account as shown: `username@host`, or the given fallback when unknown. */
export function accountLabel(actor: { username?: string | null; host?: string | null } | null | undefined, fallback: string): string {
  if (actor?.username == null || actor.username === "") return fallback;
  return actor.host ? `${actor.username}@${actor.host}` : actor.username;
}

/** Known membership outcomes: the catalog key of what to show. */
const MEMBERSHIP_OUTCOMES: Record<string, string> = {
  [errorIds.MEMBERSHIP_OFFER_EXPECTED]: "memberships.errNotMembership",
  [errorIds.MEMBERSHIP_PERMISSIONS_INVALID]: "memberships.errPermissionsInvalid",
  [errorIds.GRANTED_PERMISSIONS_NOT_SUBSET]: "memberships.errTeamsNotRequested",
};

/**
 * What the page shows when approving or declining a request failed: the
 * membership outcomes first, then the ones every invite shares (an expired or
 * used link, an account that cannot consent to itself, ...).
 */
export function membershipFailure(err: unknown, fallback: string): { message: string; tone: "danger" | "info" } {
  const { id } = platformError(err, fallback);
  const key = id != null && Object.hasOwn(MEMBERSHIP_OUTCOMES, id) ? MEMBERSHIP_OUTCOMES[id] : undefined;
  if (key != null) return { message: i18n.t(key), tone: "danger" };
  const failure = inviteFailure(err, fallback);
  return { message: failure.message, tone: failure.tone };
}

/** How a sweep ended for each access it handled. */
export interface SweepCounts {
  deleted: number;
  absent: number;
  residual: number;
}

/** Count a sweep's outcome by result. */
export function sweepCounts(outcome: ReadonlyArray<{ result?: unknown }>): SweepCounts {
  const counts: SweepCounts = { deleted: 0, absent: 0, residual: 0 };
  for (const o of outcome) {
    if (o.result === "deleted" || o.result === "absent" || o.result === "residual") counts[o.result]++;
  }
  return counts;
}

/** A sweep the platform is still working on: worth checking again. */
export function sweepInProgress(status: string): boolean {
  return status === "pending" || status === "delivered";
}

/**
 * How a sweep is shown:
 * - `running`: the platform is still working on it;
 * - `residual`: it ran, and some accesses could not be removed yet (the
 *   expected way a sweep ends when another platform is unreachable: they are
 *   retried, and each one ends at its own expiry anyway);
 * - `failed`: it stopped for another reason;
 * - `done`.
 */
export type SweepState = "running" | "residual" | "failed" | "done";

export function sweepState(sweep: { status: string; failure: { reason?: string } | null }): SweepState {
  if (sweepInProgress(sweep.status)) return "running";
  if (sweep.status === "failed") {
    return sweep.failure?.reason === errorIds.MEMBER_REVOKE_RESIDUAL ? "residual" : "failed";
  }
  return "done";
}

/** Worth checking again: still running, or accesses are left to remove. */
export function sweepCheckable(sweep: { status: string; residuals: ReadonlyArray<unknown> }): boolean {
  return sweepInProgress(sweep.status) || sweep.residuals.length > 0;
}

/** Catalog key of a sweep's state. */
export function sweepStateKey(state: SweepState): string {
  switch (state) {
    case "done":
      return "memberships.sweepStatusCompleted";
    case "failed":
      return "memberships.sweepStatusFailed";
    case "residual":
      return "memberships.sweepStatusResidual";
    case "running":
    default:
      return "memberships.sweepStatusPending";
  }
}

/** Catalog key of why a membership ended. */
export function sweepReasonKey(reason: string | null): string {
  switch (reason) {
    case "revoke":
      return "memberships.reasonRevoke";
    case "accesses.delete":
      return "memberships.reasonDeleted";
    case "expired":
      return "memberships.reasonExpired";
    case "narrowed":
      return "memberships.reasonNarrowed";
    case "detach":
      return "memberships.reasonDetach";
    case "account-deleted":
      return "memberships.reasonAccountDeleted";
    default:
      return "memberships.reasonOther";
  }
}
