/**
 * The access page's Activity card: what it asks the audit store, and how it
 * turns the answer into a 7-day chart.
 *
 * Two `events.get` calls on the access's base stream (`:_audit:access-<base>`,
 * which holds every version's entries):
 * - the window: entries since the start of the local day six days ago, newest
 *   first, at most {@link ACTIVITY_LIMIT}; classified here with
 *   `classifyMethod`, batch envelopes dropped, bucketed by local day;
 * - the last error: the newest `audit-log/pryv-api-error` entry, any time.
 */

import { AUDIT_ACCESS_STREAM_PREFIX, AUDIT_TYPE_ERROR, auditAction, isAuditError, parseAttribution, type AuditEvent } from "./audit";
import { classifyMethod } from "./methodClasses";

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

/** The two `events.get` calls of the Activity card. */
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
