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

import { DelegationError, delegationErrorIds as errorIds, delegationStatus as STATUS } from "./pryvClient";
import i18n from "../i18n";
import type {
  Delegation,
  DelegateRecord,
  ControlledRecord,
  RelationshipStatus,
} from "./pryvClient";
import type { OfferPermission } from "./consent";

/**
 * Refusal of a detach whose keep list names an access that is not a consent
 * grant of the relationship. Not yet in `@pryv/delegation`'s catalogue.
 */
export const INVALID_KEEP_LIST_ID = "delegation-invalid-keep-list";

/**
 * The account-owner warning, shown whenever someone is about to hand another
 * account full control (accepting an invite, or creating a managed account).
 *
 * A delegate is owner-equivalent for everything EXCEPT detaching a
 * relationship — and because a delegate can change the account's password, it
 * can log in directly and thereby remove other delegates too. The copy must
 * state this plainly; it must NOT claim co-delegate removal is impossible.
 */
export function delegateWarningLines(): readonly string[] {
  return [
    i18n.t("delegation.warnReadWrite"),
    i18n.t("delegation.warnCredentials"),
    i18n.t("delegation.warnAddDelete"),
    i18n.t("delegation.warnPasswordLogin"),
    i18n.t("delegation.warnRemovalAndAudit"),
  ];
}

/** One-line lead-in that precedes {@link delegateWarningLines}. */
export function delegateWarningLead(): string {
  return i18n.t("delegation.warnLead");
}

/** {@link delegateWarningLines} in the language active when this module loaded. */
export const DELEGATE_WARNING_LINES: readonly string[] = Object.freeze([...delegateWarningLines()]);

/** {@link delegateWarningLead} in the language active when this module loaded. */
export const DELEGATE_WARNING_LEAD = delegateWarningLead();

/**
 * Map a thrown error to a user-facing message. A typed {@link DelegationError}
 * is translated by its stable `.id`; anything else falls back to its message.
 */
export function delegationErrorMessage(err: unknown): string {
  const id = delegationErrorId(err);
  switch (id) {
    case errorIds.GENUINE_LOGIN_REQUIRED:
      return i18n.t("delegation.errGenuineLoginToRemove");
    case errorIds.ALREADY_EXISTS:
      return i18n.t("delegation.errAlreadyExists");
    case errorIds.UNKNOWN_USERNAME:
      return i18n.t("delegation.errUnknownUsername");
    case errorIds.SELF_NOT_ALLOWED:
      return i18n.t("delegation.errSelfNotAllowed");
    case errorIds.USERNAME_TAKEN:
      return i18n.t("delegation.errUsernameTaken");
    case errorIds.UNKNOWN_CORE:
      return i18n.t("delegation.errUnknownCore");
    case errorIds.INVITE_EXPIRED:
      return i18n.t("delegation.errInviteExpired");
    case errorIds.NOT_ACTIVE:
      return i18n.t("delegation.errNotActive");
    case errorIds.NOT_FOUND:
      return i18n.t("delegation.errNotFound");
    case errorIds.DELIVERY_FAILED:
      return i18n.t("delegation.errDeliveryFailed");
    case errorIds.CREATION_FAILED:
      return i18n.t("delegation.errCreationFailed");
    case errorIds.PERSONAL_TOKEN_REQUIRED:
      return i18n.t("delegation.errPersonalTokenRequired");
    case errorIds.MIRROR_NOT_STALE:
      return i18n.t("delegation.errMirrorNotStale");
    case errorIds.DELEGATE_MISMATCH:
      return i18n.t("delegation.errDelegateMismatch");
    case errorIds.GRANT_REQUIRES_OWNER:
      return grantRequiresOwnerMessage();
    case INVALID_KEEP_LIST_ID:
      return i18n.t("delegation.errInvalidKeepList");
    default: {
      // A refused API call raised by `pryv` carries the platform's error in
      // `innerObject` (or `response.body.error`); before `pryv` 3.14.2 its own
      // message embedded the request params, a password on account creation:
      // show the platform's message, never that one.
      const apiError = field(err, "innerObject") ?? field(field(field(err, "response"), "body"), "error");
      const apiMessage = field(apiError, "message");
      if (typeof apiMessage === "string" && apiMessage.length > 0) return apiMessage;
      if (apiError === undefined && err instanceof Error && err.message) return err.message;
      return i18n.t("delegation.errGeneric");
    }
  }
}

/**
 * Stable `delegation-*` id of a thrown error, else its first API error id, else
 * `undefined`. Also reads the API error a `pryv` `PryvError` carries (in
 * `innerObject`, or `response.body.error`), where the platform puts a delegation
 * refusal under `data.id` (the error's own `id` being the generic
 * `invalid-operation`).
 */
export function delegationErrorId(err: unknown): string | undefined {
  if (err instanceof DelegationError) return err.id;
  const inner = field(err, "innerObject");
  const body = field(field(field(err, "response"), "body"), "error");
  const ids = [err, field(err, "data"), inner, field(inner, "data"), body, field(body, "data")]
    .map((v) => field(v, "id"))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.find((id) => id.startsWith("delegation-")) ?? ids[0];
}

function field(value: unknown, key: string): unknown {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** True when the failure is the genuine-login gate on detach / cancel. */
export function isGenuineLoginRequired(err: unknown): boolean {
  return delegationErrorId(err) === errorIds.GENUINE_LOGIN_REQUIRED;
}

/**
 * Shown when the platform refuses a grant (CMC consent accept, scope update)
 * made with a token obtained through account delegation: only the account
 * owner can answer those.
 */
export function grantRequiresOwnerMessage(): string {
  return i18n.t("delegation.errGrantRequiresOwner");
}

/** {@link grantRequiresOwnerMessage} in the language active when this module loaded. */
export const GRANT_REQUIRES_OWNER_MESSAGE = grantRequiresOwnerMessage();

/** True when the platform refused a grant because the token came through a delegation. */
export function isGrantRequiresOwner(err: unknown): boolean {
  return delegationErrorId(err) === errorIds.GRANT_REQUIRES_OWNER;
}

/** Stable id of {@link GRANT_REQUIRES_OWNER_MESSAGE}, handed back to calling apps. */
export const GRANT_REQUIRES_OWNER_ID = errorIds.GRANT_REQUIRES_OWNER;

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
      return i18n.t("delegation.statusInvite");
    case STATUS.ACTIVE:
      return i18n.t("delegation.statusActive");
    case STATUS.STALE:
      return i18n.t("delegation.statusStale");
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
  relId: string;
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
    relId: rec.relId,
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
const MANAGED_KIND_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  control: "delegation.managedKindControl",
  "delegate-pat": "delegation.managedKindDelegatePat",
  "invite-capability": "delegation.managedKindInviteCapability",
  notify: "delegation.managedKindNotify",
});

/**
 * The managed kind of an access, or `null` for an ordinary access (including
 * a `delegated-child` app access).
 */
export function delegationManagedKind(
  access: { clientData?: Record<string, unknown> | null } | null | undefined,
): string | null {
  const kind = (access?.clientData?.delegation as { kind?: unknown } | null | undefined)?.kind;
  return typeof kind === "string" && Object.hasOwn(MANAGED_KIND_LABEL_KEYS, kind) ? kind : null;
}

/** Short label for a managed kind (see {@link delegationManagedKind}). */
export function managedKindLabel(kind: string): string {
  const key = Object.hasOwn(MANAGED_KIND_LABEL_KEYS, kind) ? MANAGED_KIND_LABEL_KEYS[kind] : null;
  return key ? i18n.t(key) : kind;
}

// ------------------------------------------ consents a delegate gave (review)

/** The fields of an access the detach review reads. */
export interface AccessLike {
  id: string;
  created?: number;
  permissions?: Array<Record<string, unknown>>;
  clientData?: Record<string, unknown> | null;
}

/**
 * The consent grants a delegate gave through the relationship `relId`: the
 * cross-account messaging data grants (`clientData.cmc.role` `counterparty`)
 * carrying this relationship's `delegated-child` lineage. Exactly the
 * accesses the server accepts in a detach's keep list.
 */
export function consentGrantsOf<T extends AccessLike>(accesses: readonly T[], relId: string): T[] {
  return accesses.filter((a) => {
    const cmc = a.clientData?.cmc as { role?: unknown } | null | undefined;
    const lineage = a.clientData?.delegation as { kind?: unknown; relId?: unknown } | null | undefined;
    return cmc?.role === "counterparty" && lineage?.kind === "delegated-child" && lineage.relId === relId;
  });
}

/** One consent grant as the detach review shows it. */
export interface ConsentGrantReview {
  accessId: string;
  /** Who asked: the requester's username, with its host when known. */
  requester: string;
  permissions: OfferPermission[];
  givenOnText: string;
  /** The delegate recorded on the accept event (`approvedBy`), when it could be read. */
  approvedBy: string | null;
  /** The accept event's id, to read `approvedBy` from. */
  acceptEventId: string | null;
  /**
   * False when the accept event says the consent never reached the requester
   * (not `completed`: a failed delivery awaiting its retry); such a grant
   * cannot be kept. Null when the event could not be read (it may be kept).
   */
  delivered: boolean | null;
}

export function toConsentGrantReview(access: AccessLike): ConsentGrantReview {
  const cmc = (access.clientData?.cmc ?? {}) as {
    counterparty?: { username?: unknown; host?: unknown };
    acceptEventId?: unknown;
  };
  const username = typeof cmc.counterparty?.username === "string" ? cmc.counterparty.username : "";
  const host = typeof cmc.counterparty?.host === "string" ? cmc.counterparty.host : "";
  return {
    accessId: access.id,
    requester: username && host ? username + " (" + host + ")" : username || host || i18n.t("delegation.bannerAnotherAccount"),
    permissions: (access.permissions ?? []) as OfferPermission[],
    givenOnText: formatSince(access.created),
    approvedBy: null,
    acceptEventId: typeof cmc.acceptEventId === "string" ? cmc.acceptEventId : null,
    delivered: null,
  };
}

/** Whether an accept event reached its requester (`completed`); null when it is not a readable event. */
export function acceptDelivered(event: unknown): boolean | null {
  const status = field(field(event, "content"), "status");
  return typeof status === "string" ? status === "completed" : null;
}

/** The delegate named by an accept event's `content.approvedBy`, or null. */
export function approvedByUsername(event: unknown): string | null {
  const approvedBy = field(field(event, "content"), "approvedBy");
  const username = field(field(approvedBy, "delegate"), "username");
  return typeof username === "string" && username.length > 0 ? username : null;
}

/**
 * Detach a delegate, keeping the consent grants in `keepAccessIds`. Without a
 * keep list this is the client's plain detach (nothing kept). A refused keep
 * list carries its `delegation-*` id.
 */
export async function detachDelegate(
  client: Delegation,
  username: string,
  keepAccessIds: readonly string[] = [],
): Promise<void> {
  if (keepAccessIds.length === 0) {
    await client.detachDelegate(username);
    return;
  }
  await client.detachDelegate(username, { keepAccessIds: [...keepAccessIds] });
}
