import { useTranslation } from "react-i18next";
import type { DayBucket } from "../lib/activity";

const W = 308;
const H = 120;
const LABEL_H = 18;
const PLOT_H = H - LABEL_H - 4;
const GROUP_W = W / 7;
const BAR_W = 14;
const GAP = 2;

function dayLabel(start: number, language: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(start * 1000);
  try {
    return new Intl.DateTimeFormat(language || undefined, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/**
 * Reads and writes per local day over the last 7 days, as an inline SVG bar
 * chart (no chart library): two bars per day (reads in `--color-info`, writes
 * in `--color-primary`, so a re-theme carries through), heights scaled to the
 * busiest bar, a hairline for zero. A day the window could not read in full
 * is drawn faded and named so in the table.
 *
 * For assistive technologies: `role="img"` with the totals in its label, and a
 * visually hidden table of the 7 by 2 numbers. Colour is never the only
 * carrier: the legend names the series and each bar has a tooltip.
 */
export function ActivityChart({ days }: { days: DayBucket[] }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...days.map((d) => Math.max(d.reads, d.writes)));
  const reads = days.reduce((n, d) => n + d.reads, 0);
  const writes = days.reduce((n, d) => n + d.writes, 0);
  const height = (n: number) => (n === 0 ? 1 : Math.max(2, Math.round((n / max) * PLOT_H)));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-md"
        role="img"
        aria-label={t("activity.chartLabel", { reads, writes })}
      >
        <line x1={0} x2={W} y1={PLOT_H + 0.5} y2={PLOT_H + 0.5} className="stroke-divider" strokeWidth={1} />
        {days.map((d, i) => {
          const x = i * GROUP_W + (GROUP_W - (2 * BAR_W + GAP)) / 2;
          const short = dayLabel(d.start, i18n.language, { weekday: "short" });
          const long = dayLabel(d.start, i18n.language, { weekday: "long", day: "numeric", month: "short" });
          return (
            <g key={d.start} opacity={d.incomplete ? 0.45 : 1} data-testid="activity-day">
              <rect
                x={x}
                y={PLOT_H - height(d.reads)}
                width={BAR_W}
                height={height(d.reads)}
                rx={d.reads === 0 ? 0 : 2}
                className="fill-info"
              >
                <title>{`${long}: ${t("activity.legendReads")} ${d.reads}`}</title>
              </rect>
              <rect
                x={x + BAR_W + GAP}
                y={PLOT_H - height(d.writes)}
                width={BAR_W}
                height={height(d.writes)}
                rx={d.writes === 0 ? 0 : 2}
                className="fill-primary"
              >
                <title>{`${long}: ${t("activity.legendWrites")} ${d.writes}`}</title>
              </rect>
              <text
                x={i * GROUP_W + GROUP_W / 2}
                y={H - 4}
                textAnchor="middle"
                className="fill-muted"
                fontSize={11}
              >
                {short}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-info" /> {t("activity.legendReads")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> {t("activity.legendWrites")}
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>{t("activity.last7Days")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("activity.colDay")}</th>
            <th scope="col">{t("activity.legendReads")}</th>
            <th scope="col">{t("activity.legendWrites")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.start}>
              <th scope="row">
                {dayLabel(d.start, i18n.language, { weekday: "long", day: "numeric", month: "short" })}
                {d.incomplete ? ` (${t("activity.incomplete")})` : ""}
              </th>
              <td>{d.reads}</td>
              <td>{d.writes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
