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
  };
}

/** Build the `events.get` params for one page of an access's audit trail. */
export function buildAuditGetParams(q: AuditQuery): Record<string, unknown> {
  const accessStream = AUDIT_ACCESS_STREAM_PREFIX + q.accessId;
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

/** Keep the events this access created or last modified. */
export function filterEventsByAccess(events: DataEvent[], accessId: string): DataEvent[] {
  return events.filter((e) => e.createdBy === accessId || e.modifiedBy === accessId);
}

/** Which relation(s) tie an event to the access — for the badge column. */
export function eventRelation(e: DataEvent, accessId: string): "created" | "modified" | "created + modified" {
  const created = e.createdBy === accessId;
  const modified = e.modifiedBy === accessId && e.modified !== e.created;
  if (created && modified) return "created + modified";
  return created ? "created" : "modified";
}
