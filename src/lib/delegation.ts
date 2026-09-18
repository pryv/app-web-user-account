/**
 * Account-delegation UI helpers.
 *
 * The heavy lifting lives in the `@pryv/delegation` client (one method per
 * `delegations.*` API call). This module holds the framework-free pieces the
 * route component leans on and that are worth unit-testing on their own:
 *
 *   - error-id → user-facing message mapping (typed `DelegationError`),
 *   - a small `runFlow` wrapper that turns a client call into a normalised
 *     success/failure outcome the component can render without try/catch noise,
 *   - status labels + row view-models for the two lists,
 *   - the account-owner warning copy shown at accept-time and create-time,
 *   - best-effort multi-core detection for the "create account" core selector.
 */

import { DelegationError, errorIds, STATUS } from "@pryv/delegation";
import type {
  DelegateRecord,
  ControlledRecord,
  RelationshipStatus,
} from "@pryv/delegation";

/**
 * The account-owner warning, shown whenever someone is about to hand another
 * account full control (accepting an invite, or creating a managed account).
 *
 * A delegate is owner-equivalent for everything EXCEPT detaching a
 * relationship — and because a delegate can change the account's password, it
 * can log in directly and thereby remove other delegates too. The copy must
 * state this plainly; it must NOT claim co-delegate removal is impossible.
 */
export const DELEGATE_WARNING_LINES: readonly string[] = Object.freeze([
  "They can read and change everything in the account.",
  "They can change its password, email and multi-factor authentication.",
  "They can add more delegates and delete the account entirely.",
  "Because a delegate can set the account's password, a delegate can also log in to the account directly — including to remove other delegates.",
  "Removing a delegate requires logging in to the account itself. Every credential change, login and removal is recorded in the account's audit trail.",
]);

/** One-line lead-in that precedes {@link DELEGATE_WARNING_LINES}. */
export const DELEGATE_WARNING_LEAD =
  "A delegate has full control of this account:";

/**
 * Map a thrown error to a user-facing message. A typed {@link DelegationError}
 * is translated by its stable `.id`; anything else falls back to its message.
 */
export function delegationErrorMessage(err: unknown): string {
  const id = delegationErrorId(err);
  switch (id) {
    case errorIds.GENUINE_LOGIN_REQUIRED:
      return "Sign in to this account directly to remove a delegate — a delegated session cannot do this.";
    case errorIds.ALREADY_EXISTS:
      return "There is already a pending or active delegation to this account.";
    case errorIds.UNKNOWN_USERNAME:
      return "No account was found with that username.";
    case errorIds.SELF_NOT_ALLOWED:
      return "An account cannot be delegated to itself.";
    case errorIds.USERNAME_TAKEN:
      return "That username is already taken.";
    case errorIds.UNKNOWN_CORE:
      return "The selected core is not part of this platform.";
    case errorIds.INVITE_EXPIRED:
      return "This invitation has expired.";
    case errorIds.NOT_ACTIVE:
      return "This delegation is no longer active.";
    case errorIds.NOT_FOUND:
      return "This delegation could not be found.";
    case errorIds.DELIVERY_FAILED:
      return "Could not reach the other account's server. Please try again.";
    case errorIds.CREATION_FAILED:
      return "The account could not be created. Please try again.";
    case errorIds.PERSONAL_TOKEN_REQUIRED:
      return "Sign in to this account directly to do this.";
    case errorIds.MIRROR_NOT_STALE:
      return "This account is still active and cannot be dismissed.";
    case errorIds.DELEGATE_MISMATCH:
      return "This invitation does not match the invited account.";
    default:
      if (err instanceof Error && err.message) return err.message;
      return "Something went wrong. Please try again.";
  }
}

/** Stable `delegation-*` id of a thrown error, or `undefined` when absent. */
export function delegationErrorId(err: unknown): string | undefined {
  if (err instanceof DelegationError) return err.id;
  if (
    err != null &&
    typeof err === "object" &&
    "id" in err &&
    typeof (err as { id: unknown }).id === "string"
  ) {
    return (err as { id: string }).id;
  }
  return undefined;
}

/** True when the failure is the genuine-login gate on detach / cancel. */
export function isGenuineLoginRequired(err: unknown): boolean {
  return delegationErrorId(err) === errorIds.GENUINE_LOGIN_REQUIRED;
}

/** Normalised outcome of a delegation client call. */
export type FlowResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; id?: string };

/**
 * Run a delegation client call and fold the result into a {@link FlowResult}:
 * a resolved value on success, or a translated message (+ stable id) on a
 * rejection. Keeps the component free of scattered try/catch blocks and makes
 * each flow independently testable against a mocked client.
 */
export async function runFlow<T>(fn: () => Promise<T>): Promise<FlowResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err: unknown) {
    return { ok: false, message: delegationErrorMessage(err), id: delegationErrorId(err) };
  }
}

/** Human label for a relationship status. */
export function statusLabel(status: RelationshipStatus | string): string {
  switch (status) {
    case STATUS.INVITE:
      return "Invitation pending";
    case STATUS.ACTIVE:
      return "Active";
    case STATUS.STALE:
      return "Unavailable";
    default:
      return String(status);
  }
}

/** Format a Pryv epoch-seconds timestamp as a short local date, or "" when absent. */
export function formatSince(ts?: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  return new Date(ts * 1000).toLocaleDateString();
}

/** View-model for a "My delegates" (B-side) row. */
export interface DelegateRow {
  key: string;
  username: string;
  status: RelationshipStatus;
  statusText: string;
  sinceText: string;
  /** Active → a detach action; invite → a cancel action. */
  action: "detach" | "cancel";
}

export function toDelegateRow(rec: DelegateRecord): DelegateRow {
  const since = rec.status === STATUS.ACTIVE ? rec.activatedAt : rec.requestedAt;
  return {
    key: rec.relId,
    username: rec.delegate.username,
    status: rec.status,
    statusText: statusLabel(rec.status),
    sinceText: formatSince(since),
    action: rec.status === STATUS.ACTIVE ? "detach" : "cancel",
  };
}

/** View-model for an "Accounts I manage" (A-side) row. */
export interface ControlledRow {
  key: string;
  username: string;
  hostSlug: string;
  status: RelationshipStatus;
  statusText: string;
  sinceText: string;
  /** invite → accept/refuse; active → open; stale → dismiss. */
  kind: "invite" | "active" | "stale";
}

export function toControlledRow(rec: ControlledRecord): ControlledRow {
  const kind: ControlledRow["kind"] =
    rec.status === STATUS.INVITE
      ? "invite"
      : rec.status === STATUS.STALE
        ? "stale"
        : "active";
  const since = rec.status === STATUS.INVITE ? rec.requestedAt : rec.activatedAt;
  return {
    key: rec.relId,
    username: rec.controlled.username,
    hostSlug: rec.controlled.hostSlug,
    status: rec.status,
    statusText: statusLabel(rec.status),
    sinceText: formatSince(since),
    kind,
  };
}

/** A selectable target core for the create-account form. */
export interface CoreOption {
  id: string;
  label: string;
}

/**
 * Best-effort extraction of the platform's core list from a service-info
 * object. Multi-core platforms expose their cores; single-core ones do not,
 * in which case the create-account form hides the selector. The exact
 * service-info shape varies by platform, so this reads the plausible fields
 * defensively and returns an empty list when nothing usable is present.
 */
export function coresFromServiceInfo(info: unknown): CoreOption[] {
  if (info == null || typeof info !== "object") return [];
  const raw = (info as { cores?: unknown }).cores;
  if (!Array.isArray(raw)) return [];
  const out: CoreOption[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      out.push({ id: entry, label: entry });
    } else if (entry != null && typeof entry === "object") {
      const e = entry as { id?: unknown; url?: unknown; name?: unknown };
      const id =
        typeof e.id === "string"
          ? e.id
          : typeof e.url === "string"
            ? e.url
            : typeof e.name === "string"
              ? e.name
              : null;
      if (id != null) {
        const label = typeof e.name === "string" ? e.name : id;
        out.push({ id, label });
      }
    }
  }
  return out;
}

// ------------------------------------------------- delegation-managed accesses

/**
 * `clientData.delegation.kind` values the server stamps on the accesses it
 * creates to run a delegation relationship (the control access, the
 * delegate's session, the invitation capability, the notification channel).
 * They cannot be revoked one by one (the server refuses): they go away when
 * the delegation is detached. `delegated-child` is deliberately absent: an
 * app access granted through a delegation is an ordinary, revocable app.
 */
const MANAGED_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  control: "delegation control",
  "delegate-pat": "delegate session",
  "invite-capability": "delegation invitation",
  notify: "delegation notifications",
});

/**
 * The managed kind of an access, or `null` for an ordinary access (including
 * a `delegated-child` app access).
 */
export function delegationManagedKind(
  access: { clientData?: Record<string, unknown> | null } | null | undefined,
): string | null {
  const kind = (access?.clientData?.delegation as { kind?: unknown } | null | undefined)?.kind;
  return typeof kind === "string" && Object.hasOwn(MANAGED_KIND_LABELS, kind) ? kind : null;
}

/** Short label for a managed kind (see {@link delegationManagedKind}). */
export function managedKindLabel(kind: string): string {
  return MANAGED_KIND_LABELS[kind] ?? kind;
}
