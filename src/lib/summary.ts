/**
 * `audit.getSummary`: the core counts the account's audit entries per hour,
 * day or week, by method class, in a given time zone (personal accesses only).
 * Cores older than the method answer `invalid-method` in a batch
 * (`unknown-resource` on its HTTP route); a core with the audit trail switched
 * off answers `unavailable-method`.
 */

export const SUMMARY_METHOD = "audit.getSummary";
/** Most accesses one summary call may name. */
export const SUMMARY_MAX_ACCESS_IDS = 50;

export type SummaryBucketUnit = "hour" | "day" | "week";

export interface SummaryBucket {
  /** Start of the bucket in the asked time zone, Unix seconds (earlier than `fromTime` for a partial first bucket). */
  time: number;
  total: number;
  reads: number;
  writes: number;
  session: number;
  other: number;
  /** Error entries among them (an overlay, not a class). */
  errors: number;
}

export interface AuditSummary {
  bucket: SummaryBucketUnit;
  timezone: string;
  fromTime: number;
  toTime: number;
  /** Every bucket of the range, zeros included, oldest first. */
  buckets: SummaryBucket[];
}

/** The browser's IANA time zone, or undefined when it does not say (the core then uses UTC). */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** One `audit.getSummary` call, up to now, in the browser's time zone. */
export function buildSummaryCall(q: {
  fromTime: number;
  bucket: SummaryBucketUnit;
  accessIds?: string[];
}): { method: typeof SUMMARY_METHOD; params: Record<string, unknown> } {
  const params: Record<string, unknown> = { fromTime: q.fromTime, bucket: q.bucket };
  const timezone = browserTimeZone();
  if (timezone) params.timezone = timezone;
  if (q.accessIds) params.accessIds = q.accessIds;
  return { method: SUMMARY_METHOD, params };
}

type ApiErrorLike = { id?: string } | null | undefined;

/** The core does not know the method (older than it). */
export function isSummaryUnsupported(error: ApiErrorLike): boolean {
  return error?.id === "invalid-method" || error?.id === "unknown-resource";
}

/** The core knows the method but its audit trail is switched off. */
export function isSummaryUnavailable(error: ApiErrorLike): boolean {
  return error?.id === "unavailable-method";
}

/** The summary of a call result, or null when the result does not hold a readable one. */
export function readSummary(res: { summary?: unknown } | null | undefined): AuditSummary | null {
  const s = res?.summary as AuditSummary | undefined;
  if (s == null || typeof s !== "object" || !Array.isArray(s.buckets)) return null;
  const ok = s.buckets.every((b) => b != null && typeof b.time === "number" && Number.isFinite(b.time));
  return ok ? s : null;
}

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Sums of the counters over every bucket. */
export function summaryTotals(s: AuditSummary): Omit<SummaryBucket, "time"> {
  const out = { total: 0, reads: 0, writes: 0, session: 0, other: 0, errors: 0 };
  for (const b of s.buckets) {
    out.total += count(b.total);
    out.reads += count(b.reads);
    out.writes += count(b.writes);
    out.session += count(b.session);
    out.other += count(b.other);
    out.errors += count(b.errors);
  }
  return out;
}

/** The summary as chart bars (reads and writes per bucket). */
export function summaryBars(s: AuditSummary): Array<{ start: number; reads: number; writes: number; incomplete: boolean }> {
  return s.buckets.map((b) => ({ start: b.time, reads: count(b.reads), writes: count(b.writes), incomplete: false }));
}

/** The periods the Audit trail's summary offers. */
export const SUMMARY_RANGES = ["24h", "7d", "30d", "52w"] as const;
export type SummaryRange = (typeof SUMMARY_RANGES)[number];

/**
 * The start and bucket of a period ending now, aligned on local bucket starts
 * so that no bucket is partial but the current one: the last 24 hours (hour
 * buckets), the last 7 or 30 days (day buckets, local midnights), the last 52
 * weeks (week buckets, Monday midnights).
 */
export function summaryRange(range: SummaryRange, now: Date): { fromTime: number; bucket: SummaryBucketUnit } {
  const [y, m, d, h] = [now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()];
  switch (range) {
    case "24h":
      return { fromTime: new Date(y, m, d, h - 23).getTime() / 1000, bucket: "hour" };
    case "7d":
      return { fromTime: new Date(y, m, d - 6).getTime() / 1000, bucket: "day" };
    case "30d":
      return { fromTime: new Date(y, m, d - 29).getTime() / 1000, bucket: "day" };
    case "52w": {
      const monday = d - ((now.getDay() + 6) % 7);
      return { fromTime: new Date(y, m, monday - 51 * 7).getTime() / 1000, bucket: "week" };
    }
  }
}
