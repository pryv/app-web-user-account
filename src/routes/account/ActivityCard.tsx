import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Card, Alert } from "../../components/ui";
import { ActivityChart } from "../../components/ActivityChart";
import type { PryvConnection } from "../../lib/session";
import { parseAttribution, type AccessUsage, type AuditEvent } from "../../lib/audit";
import { ACTIVITY_LIMIT, buildActivityCalls, summarizeActivity, type ActivitySummary } from "../../lib/activity";
import { formatDateTime } from "../../lib/dates";
import { maskUrlCredentials } from "../../lib/maskCredentials";
import { platformError } from "../../lib/apiError";
import { searchWith } from "../../lib/trail";

/**
 * The access page's summary of what was done with an access: lifetime counts
 * (when the core returns `usage`), the last error, a 7-day read/write chart
 * and a link to its entries in the Audit trail tab.
 */
export function ActivityCard({
  connection,
  accessId,
  usage,
  search,
}: {
  connection: PryvConnection;
  accessId: string;
  /** `usage` of the access from `accesses.get`, when the core tracks it. */
  usage?: AccessUsage | null;
  /** The current query string (hand-off parameters), carried to the Audit trail link. */
  search: string;
}) {
  const { t } = useTranslation();
  const base = parseAttribution(accessId).base;
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [lastError, setLastError] = useState<AuditEvent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The last-error call failed on its own (the window call answered).
  const [lastErrorFailed, setLastErrorFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setLastError(undefined);
    setError(null);
    setLastErrorFailed(null);
    const now = new Date();
    void (async () => {
      try {
        const [win, last] = (await connection.api(buildActivityCalls(base, now))) as Array<{
          events?: AuditEvent[];
          error?: { message: string };
        }>;
        if (cancelled) return;
        if (win?.error) throw new Error(win.error.message);
        setSummary(summarizeActivity(win?.events ?? [], now));
        if (last?.error) {
          setLastErrorFailed(maskUrlCredentials(last.error.message ?? ""));
        } else {
          setLastError(last?.events?.[0] ?? null);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(maskUrlCredentials(platformError(err, t("activity.errorLoad")).message));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, base, t]);

  const lifetime =
    usage != null && typeof usage === "object" && typeof usage.total === "number"
      ? ([
          ["activity.total", usage.total],
          ["activity.reads", usage.reads],
          ["activity.writes", usage.writes],
          ["activity.session", usage.session],
          ["activity.other", usage.other],
        ] as const)
      : null;

  return (
    <Card>
      <h2 className="mb-3 text-xs font-normal uppercase tracking-wide text-muted">{t("activity.heading")}</h2>

      {lifetime && (
        <section className="mb-4" data-testid="activity-lifetime">
          <h3 className="mb-1 text-sm font-medium">{t("activity.lifetime")}</h3>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {lifetime.map(([key, n]) => (
              <div key={key}>
                <dt className="text-xs text-muted">{t(key)}</dt>
                <dd className="tabular-nums">{typeof n === "number" ? n : 0}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-muted">{t("activity.lifetimeHint")}</p>
        </section>
      )}

      <section className="mb-4" data-testid="activity-last-error">
        <h3 className="mb-1 text-sm font-medium">{t("activity.lastError")}</h3>
        {lastError === undefined && !error && lastErrorFailed === null && (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        )}
        {lastErrorFailed !== null && (
          <p className="text-sm text-muted" data-testid="activity-last-error-failed">
            {t("activity.errorLastError")}
            {lastErrorFailed && (
              <>
                {" "}
                <span className="break-all font-mono text-xs">{lastErrorFailed}</span>
              </>
            )}
          </p>
        )}
        {lastError === null && <p className="text-sm text-muted">{t("activity.noError")}</p>}
        {lastError && (
          <p className="text-sm">
            <span className="text-muted">{formatDateTime(lastError.time)}</span>{" "}
            <span className="break-all font-mono text-xs">
              {maskUrlCredentials([lastError.content?.id, lastError.content?.message].filter(Boolean).join(": ")) || "—"}
            </span>
          </p>
        )}
      </section>

      <section data-testid="activity-week">
        <h3 className="mb-1 text-sm font-medium">{t("activity.last7Days")}</h3>
        {error && <Alert>{error}</Alert>}
        {!summary && !error && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {summary && (
          <>
            {summary.truncated && (
              <Alert tone="info">{t("activity.truncated", { limit: ACTIVITY_LIMIT })}</Alert>
            )}
            <ActivityChart days={summary.days} />
            <p className="mt-2 text-xs text-muted" data-testid="activity-caption">
              {summary.reads + summary.writes + summary.session + summary.other === 0
                ? t("activity.noActivity")
                : t("activity.otherCounts", { session: summary.session, other: summary.other })}
              {" · "}
              {t("activity.errorsCount", { count: summary.errors })}
            </p>
          </>
        )}
      </section>

      <p className="mt-4 text-sm">
        <Trans
          i18nKey="activity.rawData"
          components={{
            raw: <Link to={"/account/audit" + searchWith(search, { access: base })} className="text-primary underline" />,
          }}
        />
      </p>
    </Card>
  );
}
