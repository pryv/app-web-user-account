import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Alert } from "../../components/ui";
import { ActivityChart } from "../../components/ActivityChart";
import type { PryvConnection } from "../../lib/session";
import {
  SUMMARY_MAX_ACCESS_IDS,
  SUMMARY_RANGES,
  buildSummaryCall,
  isSummaryUnavailable,
  isSummaryUnsupported,
  readSummary,
  summaryBars,
  summaryRange,
  summaryTotals,
  type AuditSummary,
  type SummaryRange,
} from "../../lib/summary";
import { maskUrlCredentials } from "../../lib/maskCredentials";
import { platformError } from "../../lib/apiError";

const INPUT =
  "rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary";

/**
 * The Audit trail tab's activity chart: reads and writes per hour, day or week
 * over a chosen period, counted by the core (`audit.getSummary`, browser time
 * zone), for the accesses the trail is filtered to or the whole account. The
 * kind and action filters apply to the list only. Not shown on a core without
 * the method, or with its audit trail switched off, nor when the view names no
 * access or more than one call may.
 */
export function TrailSummary({
  connection,
  accessIds,
  refreshTick,
}: {
  connection: PryvConnection;
  /** The accesses of the view (base ids); null for the whole account, undefined while resolving. */
  accessIds: string[] | null | undefined;
  /** Bumped by the trail's Refresh: ask again. */
  refreshTick: number;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState<SummaryRange>("7d");
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const outOfScope = accessIds != null && (accessIds.length === 0 || accessIds.length > SUMMARY_MAX_ACCESS_IDS);
  const idsKey = JSON.stringify(accessIds);

  useEffect(() => {
    // A chart of other filters is never left on screen while the new ones resolve.
    setSummary(null);
    setError(null);
    if (accessIds === undefined || outOfScope || hidden) return;
    let cancelled = false;
    const { fromTime, bucket } = summaryRange(range, new Date());
    void (async () => {
      try {
        const [res] = (await connection.api([
          buildSummaryCall({ fromTime, bucket, accessIds: accessIds ?? undefined }),
        ])) as Array<{ summary?: unknown; error?: { id?: string; message: string } }>;
        if (cancelled) return;
        if (isSummaryUnsupported(res?.error) || isSummaryUnavailable(res?.error)) {
          setHidden(true);
          return;
        }
        if (res?.error) throw new Error(res.error.message);
        const read = readSummary(res);
        if (read == null) throw new Error(t("trail.summaryError"));
        setSummary(read);
      } catch (err: unknown) {
        if (!cancelled) setError(maskUrlCredentials(platformError(err, t("trail.summaryError")).message));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `accessIds` is keyed by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, idsKey, outOfScope, hidden, range, refreshTick, t]);

  if (hidden || outOfScope) return null;
  const totals = summary ? summaryTotals(summary) : null;
  const rangeLabel = t("trail.range_" + range);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xs font-normal uppercase tracking-wide text-muted">{t("trail.summaryTitle")}</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">{t("trail.range")}</span>
          <select value={range} onChange={(e) => setRange(e.target.value as SummaryRange)} className={INPUT}>
            {SUMMARY_RANGES.map((r) => (
              <option key={r} value={r}>
                {t("trail.range_" + r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {!summary && !error && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {summary && totals && (
        <div data-testid="trail-summary">
          <ActivityChart
            days={summaryBars(summary)}
            unit={summary.bucket}
            label={t("trail.summaryChartLabel", { range: rangeLabel, reads: totals.reads, writes: totals.writes })}
            caption={rangeLabel}
          />
          <p className="mt-2 text-xs text-muted" data-testid="trail-summary-caption">
            {totals.total === 0
              ? t("trail.summaryNone")
              : t("trail.summaryCounts", { total: totals.total, session: totals.session, other: totals.other })}
            {" · "}
            {t("activity.errorsCount", { count: totals.errors })}
          </p>
          <p className="mt-1 text-xs text-muted">{t("trail.summaryHint")}</p>
        </div>
      )}
    </Card>
  );
}
