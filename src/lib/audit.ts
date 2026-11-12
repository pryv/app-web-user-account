/**
 * Audit-trail helpers. The API exposes the audit log as a read-only store
 * queried through the regular `events.get` method: each access has a
 * `:_audit:access-<accessId>` stream, each API method an
 * `:_audit:action-<method>` stream; entries are `audit-log/pryv-api` events
 * (`audit-log/pryv-api-error` for failed calls).
 */

import { classifyMethod } from "./methodClasses";

export const AUDIT_ACCESS_STREAM_PREFIX = ":_audit:access-";
export const AUDIT_ACTION_STREAM_PREFIX = ":_audit:action-";
/** Parent stream whose children enumerate the actions used on this account. */
export const AUDIT_ACTIONS_PARENT_STREAM_ID = ":_audit:actions";
export const AUDIT_TYPE_VALID = "audit-log/pryv-api";
export const AUDIT_TYPE_ERROR = "audit-log/pryv-api-error";

export interface AuditEvent {
  id: string;
  time: number;
  type: string;
  streamIds?: string[];
  content?: {
    source?: { name?: string; ip?: string };
    action?: string;
    query?: Record<string, unknown>;
    id?: string; // error id on error entries
    message?: string; // error message on error entries
    /**
     * Label the caller sent with its token (`Authorization: <token> <callerId>`).
     * Chosen by the caller: never an authenticated identity.
     */
    callerId?: string;
  };
}

/**
 * An access as the access details page loads it (`accesses.get` with
 * `includeExpired` and `includeDeletions`). Also the `access` prop of the
 * `AccessExtras` extension.
 */
export interface AccessDetails {
  id: string;
  name?: string;
  type?: string;
  deviceName?: string;
  permissions?: Array<{ streamId?: string; tag?: string; feature?: string; level?: string; setting?: string }>;
  created?: number;
  createdBy?: string;
  modified?: number;
  modifiedBy?: string;
  lastUsed?: number;
  expires?: number | null;
  expired?: boolean;
  clientData?: Record<string, unknown>;
  /** Set on a removed access (an `accessDeletions` record): when it was deleted, Unix seconds. */
  deleted?: number;
  /**
   * Approximate lifetime call counts, returned by the core to the account
   * owner (a personal access) when it tracks them; absent otherwise.
   */
  usage?: AccessUsage;
}

/** Lifetime call counters of an access, as the core returns them to the owner on `accesses.get`. */
export interface AccessUsage {
  total: number;
  reads: number;
  writes: number;
  session: number;
  other: number;
  /** Calls per method id (`events.get`), batch envelopes not counted. */
  byMethod?: Record<string, number>;
}

/**
 * An access reference as the platform stores it in `createdBy` / `modifiedBy`
 * (of an access or an event): the access id, followed by `:<serial>` when the
 * access was updated since, and by ` <callerId>` when the call carried one.
 */
export interface AccessAttribution {
  /** The access id without its `:<serial>` suffix: the same for every version. */
  base: string;
  /** The label the caller sent with its token, if any (never verified). */
  callerId?: string;
}

export function parseAttribution(ref: string): AccessAttribution {
  const space = ref.indexOf(" ");
  const accessRef = space === -1 ? ref : ref.slice(0, space);
  const callerId = space === -1 ? "" : ref.slice(space + 1);
  const colon = accessRef.indexOf(":");
  const base = colon === -1 ? accessRef : accessRef.slice(0, colon);
  return callerId ? { base, callerId } : { base };
}

/** Whether two access references (ids, attributions) name the same access. */
export function sameAccess(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return parseAttribution(a).base === parseAttribution(b).base;
}

/**
 * The response of `accesses.get` with `includeDeletions`, as one list: live
 * (and expired) accesses first, then the removed ones (`deleted` set).
 */
export function accessesWithDeletions(res: {
  accesses?: AccessDetails[];
  accessDeletions?: AccessDetails[];
}): AccessDetails[] {
  return [...(res.accesses ?? []), ...(res.accessDeletions ?? [])];
}

/**
 * The access a reference (an id, a `createdBy`) names in that list: the exact
 * id first, then the same access under another version (`<id>:<serial>`).
 */
export function findAccess(list: AccessDetails[], ref: string | undefined | null): AccessDetails | undefined {
  if (!ref) return undefined;
  return list.find((a) => a.id === ref) ?? list.find((a) => sameAccess(a.id, ref));
}

/** What the Audit trail tab filters on (see `buildTrailGetParams`). */
export type TrailKind = "read" | "write" | "session" | "error";

export interface TrailQuery {
  /**
   * The accesses whose entries to list (ids, bare or with `:<serial>`), or
   * null for every access of the account. An empty list matches nothing.
   */
  accessIds: string[] | null;
  kind?: TrailKind;
  /** One API method id; wins over a class `kind` (it is the narrower filter). */
  action?: string;
  /**
   * The methods ever used on the account (the children of `:_audit:actions`):
   * a class `kind` selects those of its class.
   */
  actions: string[];
  /** Unix time in SECONDS (Pryv API convention); omit for open-ended. */
  fromTime?: number;
  toTime?: number;
  page: number;
  pageSize: number;
}

/**
 * Build the `events.get` params for one page of the Audit trail, or null when
 * nothing can match (no access, or a class no method of the account is in).
 *
 * Every entry is filed under its access's base id (`access-<id>`), and those
 * made under an updated version also under `access-<id>:<serial>`: querying
 * the base stream lists the whole trail of an access, before and after each
 * update. Streams blocks (an array of blocks is OR; inside a block `any` is OR,
 * `all` is AND):
 * - accesses only: `[{ any: [access-A1, ...] }]`
 * - accesses and an action: `[{ any: [access-A1, ...], all: [action-m] }]`
 * - accesses and a class: one block per access, `{ any: <class actions>, all: [access-Ai] }`
 * - a class only: `[{ any: <class actions> }]`; an action only: `[{ any: [action-m] }]`
 * - nothing: the whole log (`[":_audit:actions"]`).
 * `kind=error` selects the error entries (`types`), with any of the above.
 * `callBatch` is in no class, so a class never lists batch envelopes.
 */
export function buildTrailGetParams(q: TrailQuery): Record<string, unknown> | null {
  const accesses =
    q.accessIds == null
      ? null
      : [...new Set(q.accessIds.map((id) => AUDIT_ACCESS_STREAM_PREFIX + parseAttribution(id).base))];
  if (accesses != null && accesses.length === 0) return null;
  const cls = q.action ? null : q.kind === "read" || q.kind === "write" || q.kind === "session" ? q.kind : null;
  let streams: unknown[];
  if (q.action) {
    const action = AUDIT_ACTION_STREAM_PREFIX + q.action;
    streams = accesses ? [{ any: accesses, all: [action] }] : [{ any: [action] }];
  } else if (cls) {
    const members = q.actions
      .filter((m) => classifyMethod(m) === cls)
      .map((m) => AUDIT_ACTION_STREAM_PREFIX + m);
    if (members.length === 0) return null;
    streams = accesses ? accesses.map((a) => ({ any: members, all: [a] })) : [{ any: members }];
  } else {
    streams = accesses ? [{ any: accesses }] : [AUDIT_ACTIONS_PARENT_STREAM_ID];
  }
  const params: Record<string, unknown> = {
    streams,
    sortAscending: false,
    // One extra row tells whether a next page exists.
    limit: q.pageSize + 1,
    skip: q.page * q.pageSize,
  };
  if (q.fromTime !== undefined) params.fromTime = q.fromTime;
  if (q.toTime !== undefined) params.toTime = q.toTime;
  if (q.kind === "error") params.types = [AUDIT_TYPE_ERROR];
  return params;
}

/** The base id of the access an audit entry is filed under, or null. */
export function auditAccessId(e: AuditEvent): string | null {
  const stream = e.streamIds?.find((s) => s.startsWith(AUDIT_ACCESS_STREAM_PREFIX));
  return stream ? parseAttribution(stream.slice(AUDIT_ACCESS_STREAM_PREFIX.length)).base : null;
}

/** Extract the API action (`events.get`, `auth.login`, …) from an audit event. */
export function auditAction(e: AuditEvent): string {
  const fromStream = e.streamIds
    ?.find((s) => s.startsWith(AUDIT_ACTION_STREAM_PREFIX))
    ?.slice(AUDIT_ACTION_STREAM_PREFIX.length);
  return fromStream ?? e.content?.action ?? "?";
}

export function isAuditError(e: AuditEvent): boolean {
  return e.type === AUDIT_TYPE_ERROR;
}

/** `datetime-local` input value → Unix seconds (undefined for empty input). */
export function dateInputToTime(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms / 1000;
}

/**
 * "Data created / modified by this access" — `events.get` has no
 * createdBy/modifiedBy filter, so we batch-fetch the time window and filter
 * client-side. `DATA_BATCH_LIMIT` bounds the fetch; when the batch comes back
 * full, the UI flags that older matches may exist beyond the window.
 */
export const DATA_BATCH_LIMIT = 500;

export interface DataEvent {
  id: string;
  time: number;
  type: string;
  streamIds?: string[];
  content?: unknown;
  created?: number;
  createdBy?: string;
  modified?: number;
  modifiedBy?: string;
  trashed?: boolean;
}

export function buildDataGetParams(q: {
  fromTime?: number;
  toTime?: number;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    sortAscending: false,
    limit: DATA_BATCH_LIMIT,
    state: "all",
  };
  if (q.fromTime !== undefined) params.fromTime = q.fromTime;
  if (q.toTime !== undefined) params.toTime = q.toTime;
  return params;
}

/**
 * Keep the events this access created or last modified, whatever its version
 * and whether or not the call carried a caller label.
 */
export function filterEventsByAccess(events: DataEvent[], accessId: string): DataEvent[] {
  return events.filter((e) => sameAccess(e.createdBy, accessId) || sameAccess(e.modifiedBy, accessId));
}

/** Which relation(s) tie an event to the access — for the badge column. */
export function eventRelation(e: DataEvent, accessId: string): "created" | "modified" | "created + modified" {
  const created = sameAccess(e.createdBy, accessId);
  const modified = sameAccess(e.modifiedBy, accessId) && e.modified !== e.created;
  if (created && modified) return "created + modified";
  return created ? "created" : "modified";
}
