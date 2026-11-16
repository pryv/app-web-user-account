import { useTranslation } from "react-i18next";
import type { DayBucket } from "../lib/activity";
import type { SummaryBucketUnit } from "../lib/summary";

const H = 120;
const LABEL_H = 18;
const PLOT_H = H - LABEL_H - 4;
/** Most axis labels drawn; with more buckets, every n-th one is labelled. */
const MAX_LABELS = 8;

function dateLabel(start: number, language: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(start * 1000);
  try {
    return new Intl.DateTimeFormat(language || undefined, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** How a bucket is named: short under the axis, long in tooltips and the table. */
function labelFormats(unit: SummaryBucketUnit, count: number): { short: Intl.DateTimeFormatOptions; long: Intl.DateTimeFormatOptions } {
  if (unit === "hour") {
    return { short: { hour: "2-digit" }, long: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } };
  }
  if (unit === "week") {
    return { short: { day: "numeric", month: "short" }, long: { day: "numeric", month: "short", year: "numeric" } };
  }
  return {
    short: count <= 7 ? { weekday: "short" } : { day: "numeric", month: "short" },
    long: { weekday: "long", day: "numeric", month: "short" },
  };
}

/**
 * Reads and writes per bucket (hour, local day or week), as an inline SVG bar
 * chart (no chart library): two bars per bucket (reads in `--color-info`,
 * writes in `--color-primary`, so a re-theme carries through), heights scaled
 * to the busiest bar, a hairline for zero. A bucket that could not be read in
 * full is drawn faded and named so in the table.
 *
 * For assistive technologies: `role="img"` with `label` (by default the 7-day
 * totals), and a visually hidden table of the numbers. Colour is never the
 * only carrier: the legend names the series and each bar has a tooltip.
 */
export function ActivityChart({
  days,
  unit = "day",
  label,
  caption,
}: {
  days: DayBucket[];
  unit?: SummaryBucketUnit;
  /** The chart's accessible name; default: the 7-day totals. */
  label?: string;
  /** The hidden table's caption; default: "Last 7 days". */
  caption?: string;
}) {
  const { t, i18n } = useTranslation();
  const n = Math.max(1, days.length);
  const W = n <= 7 ? 308 : 616;
  const groupW = W / n;
  const gap = groupW >= 8 ? 2 : 0.5;
  const barW = Math.min(14, Math.max(1, (groupW - gap - 2) / 2));
  const every = Math.ceil(n / MAX_LABELS);
  const formats = labelFormats(unit, days.length);
  const max = Math.max(1, ...days.map((d) => Math.max(d.reads, d.writes)));
  const reads = days.reduce((s, d) => s + d.reads, 0);
  const writes = days.reduce((s, d) => s + d.writes, 0);
  const height = (v: number) => (v === 0 ? 1 : Math.max(2, Math.round((v / max) * PLOT_H)));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={"h-auto w-full " + (n <= 7 ? "max-w-md" : "max-w-2xl")}
        role="img"
        aria-label={label ?? t("activity.chartLabel", { reads, writes })}
      >
        <line x1={0} x2={W} y1={PLOT_H + 0.5} y2={PLOT_H + 0.5} className="stroke-divider" strokeWidth={1} />
        {days.map((d, i) => {
          const x = i * groupW + (groupW - (2 * barW + gap)) / 2;
          const long = dateLabel(d.start, i18n.language, formats.long);
          return (
            <g key={d.start} opacity={d.incomplete ? 0.45 : 1} data-testid="activity-day">
              <rect
                x={x}
                y={PLOT_H - height(d.reads)}
                width={barW}
                height={height(d.reads)}
                rx={d.reads === 0 || barW < 4 ? 0 : 2}
                className="fill-info"
              >
                <title>{`${long}: ${t("activity.legendReads")} ${d.reads}`}</title>
              </rect>
              <rect
                x={x + barW + gap}
                y={PLOT_H - height(d.writes)}
                width={barW}
                height={height(d.writes)}
                rx={d.writes === 0 || barW < 4 ? 0 : 2}
                className="fill-primary"
              >
                <title>{`${long}: ${t("activity.legendWrites")} ${d.writes}`}</title>
              </rect>
              {i % every === 0 && (
                <text
                  // With more buckets than labels, a centred edge label would be cut by the frame: anchor it inward.
                  x={every > 1 && i === 0 ? 0 : every > 1 && i === n - 1 ? W : i * groupW + groupW / 2}
                  y={H - 4}
                  textAnchor={every > 1 && i === 0 ? "start" : every > 1 && i === n - 1 ? "end" : "middle"}
                  className="fill-muted"
                  fontSize={11}
                >
                  {dateLabel(d.start, i18n.language, formats.short)}
                </text>
              )}
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
        <caption>{caption ?? t("activity.last7Days")}</caption>
        <thead>
          <tr>
            <th scope="col">{t(unit === "hour" ? "activity.colHour" : unit === "week" ? "activity.colWeek" : "activity.colDay")}</th>
            <th scope="col">{t("activity.legendReads")}</th>
            <th scope="col">{t("activity.legendWrites")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.start}>
              <th scope="row">
                {dateLabel(d.start, i18n.language, formats.long)}
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
