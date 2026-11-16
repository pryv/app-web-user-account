/**
 * The access page's Activity card: what it asks the audit store, and how it
 * turns the answer into a 7-day chart.
 *
 * Two calls, in one batch:
 * - the 7 days: `audit.getSummary` with day buckets in the browser's time
 *   zone since the start of the local day six days ago, for the access's base
 *   id (every version); the core classifies and counts;
 * - the last error: `events.get` of the newest `audit-log/pryv-api-error`
 *   entry of the access's base stream (`:_audit:access-<base>`), any time.
 *
 * On a core without `audit.getSummary`, the 7 days come from the former
 * window instead: `events.get` on the base stream since the same day, newest
 * first, at most {@link ACTIVITY_LIMIT}, classified here with
 * `classifyMethod`, batch envelopes dropped, bucketed by local day.
 */

import { AUDIT_ACCESS_STREAM_PREFIX, AUDIT_TYPE_ERROR, auditAction, isAuditError, parseAttribution, type AuditEvent } from "./audit";
import { classifyMethod } from "./methodClasses";
import { buildSummaryCall, summaryBars, summaryTotals, type AuditSummary } from "./summary";

export const ACTIVITY_DAYS = 7;
export const ACTIVITY_LIMIT = 1000;

/** The start of each of the last 7 local days, oldest first, as Date objects. */
export function activityDays(now: Date): Date[] {
  const days: Date[] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    // Local midnight, also across a daylight-saving change (a day is not always 24 h).
    days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
  }
  return days;
}

/** The `audit.getSummary` call of the 7 days, for the access's base id. */
export function buildActivitySummaryCall(accessId: string, now: Date) {
  return buildSummaryCall({
    fromTime: activityDays(now)[0].getTime() / 1000,
    bucket: "day",
    accessIds: [parseAttribution(accessId).base],
  });
}

/** The two `events.get` calls of the Activity card on a core without `audit.getSummary`: the window, the last error. */
export function buildActivityCalls(accessId: string, now: Date): Array<{ method: "events.get"; params: Record<string, unknown> }> {
  const stream = AUDIT_ACCESS_STREAM_PREFIX + parseAttribution(accessId).base;
  return [
    {
      method: "events.get",
      params: {
        streams: [stream],
        fromTime: activityDays(now)[0].getTime() / 1000,
        limit: ACTIVITY_LIMIT,
        sortAscending: false,
      },
    },
    {
      method: "events.get",
      params: { streams: [stream], types: [AUDIT_TYPE_ERROR], limit: 1, sortAscending: false },
    },
  ];
}

export interface DayBucket {
  /** Local midnight of the day, Unix seconds. */
  start: number;
  reads: number;
  writes: number;
  /** The window came back full and this day may be missing entries. */
  incomplete: boolean;
}

export interface ActivitySummary {
  days: DayBucket[];
  reads: number;
  writes: number;
  session: number;
  other: number;
  /** Error entries in the window (batch envelopes left out). */
  errors: number;
  /** The window came back with {@link ACTIVITY_LIMIT} entries: older ones were not read. */
  truncated: boolean;
}

/** The card's figures from the core's summary (complete by construction: no window limit). */
export function activityFromSummary(s: AuditSummary): ActivitySummary {
  const totals = summaryTotals(s);
  return {
    days: summaryBars(s),
    reads: totals.reads,
    writes: totals.writes,
    session: totals.session,
    other: totals.other,
    errors: totals.errors,
    truncated: false,
  };
}

/** Bucket the window's entries (any order) into the last 7 local days. */
export function summarizeActivity(rows: AuditEvent[], now: Date): ActivitySummary {
  const starts = activityDays(now).map((d) => d.getTime() / 1000);
  const days: DayBucket[] = starts.map((start) => ({ start, reads: 0, writes: 0, incomplete: false }));
  const summary: ActivitySummary = { days, reads: 0, writes: 0, session: 0, other: 0, errors: 0, truncated: rows.length >= ACTIVITY_LIMIT };
  let oldest = Infinity;
  for (const row of rows) {
    if (typeof row.time !== "number" || !Number.isFinite(row.time)) continue;
    oldest = Math.min(oldest, row.time);
    const cls = classifyMethod(auditAction(row));
    if (cls === "batch") continue;
    if (isAuditError(row)) summary.errors++;
    if (cls === "session" || cls === "other") {
      summary[cls]++;
      continue;
    }
    let index = -1;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (row.time >= starts[i]) {
        index = i;
        break;
      }
    }
    if (index === -1) continue;
    if (cls === "read") {
      days[index].reads++;
      summary.reads++;
    } else {
      days[index].writes++;
      summary.writes++;
    }
  }
  if (summary.truncated && Number.isFinite(oldest)) {
    // Entries older than the oldest one read are missing: its day and the days before it.
    for (const day of days) if (day.start <= oldest) day.incomplete = true;
  }
  return summary;
}
