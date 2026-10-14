/**
 * Audit-trail helpers. The API exposes the audit log as a read-only store
 * queried through the regular `events.get` method: each access has a
 * `:_audit:access-<accessId>` stream, each API method an
 * `:_audit:action-<method>` stream; entries are `audit-log/pryv-api` events
 * (`audit-log/pryv-api-error` for failed calls).
 */

export const AUDIT_ACCESS_STREAM_PREFIX = ":_audit:access-";
export const AUDIT_ACTION_STREAM_PREFIX = ":_audit:action-";
/** Parent stream whose children enumerate the actions used on this account. */
export const AUDIT_ACTIONS_PARENT_STREAM_ID = ":_audit:actions";
export const AUDIT_TYPE_VALID = "audit-log/pryv-api";
export const AUDIT_TYPE_ERROR = "audit-log/pryv-api-error";

export interface AuditQuery {
  /** The access id, bare or with its `:<serial>` (the trail covers every version). */
  accessId: string;
  /** Unix time in SECONDS (Pryv API convention); omit for open-ended. */
  fromTime?: number;
  toTime?: number;
  errorsOnly?: boolean;
  /** API method id (`events.get`, `auth.login`, …); omit for all actions. */
  action?: string;
  page: number;
  pageSize: number;
}

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

/**
 * Build the `events.get` params for one page of an access's audit trail.
 * Every entry is filed under the access's base id (`access-<id>`), and those
 * made under an updated version also under `access-<id>:<serial>`: querying
 * the base stream lists the whole trail, before and after each update.
 */
export function buildAuditGetParams(q: AuditQuery): Record<string, unknown> {
  const accessStream = AUDIT_ACCESS_STREAM_PREFIX + parseAttribution(q.accessId).base;
  const params: Record<string, unknown> = {
    // Filtering on an action too needs AND semantics — the streams-query
    // object form ({any} AND {all}); a plain array would mean OR.
    streams: q.action
      ? [{ any: [accessStream], all: [AUDIT_ACTION_STREAM_PREFIX + q.action] }]
      : [accessStream],
    sortAscending: false,
    // One extra row tells us whether a next page exists.
    limit: q.pageSize + 1,
    skip: q.page * q.pageSize,
  };
  if (q.fromTime !== undefined) params.fromTime = q.fromTime;
  if (q.toTime !== undefined) params.toTime = q.toTime;
  if (q.errorsOnly) params.types = [AUDIT_TYPE_ERROR];
  return params;
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
