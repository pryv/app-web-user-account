import i18n from "../i18n";

/*
 * Dates as the pages show them: in the page's language (the i18n one, not the
 * browser's), with a short month name where the language has one, so
 * "5 October" never reads as "10 May" (an all-numeric en date is month first).
 * A language the runtime cannot format in falls back to the browser's, in the
 * same style.
 */

// `month: "short"` asks for the month's short name; `dateStyle: "medium"`
// would be all-numeric in more languages (German "05.10.2026"). A few
// languages have no short month name in this pattern and stay numeric
// (Finnish "5.10.2026", Czech "5. 10. 2026", Lithuanian "2026-10-05"), in
// their own day-first or year-first order, so they are not read month first.
const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
// With seconds: the audit trail tells apart events of the same minute.
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: "numeric", minute: "2-digit", second: "2-digit" };

function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return date.toLocaleString(i18n.language || undefined, options);
  } catch {
    return date.toLocaleString(undefined, options);
  }
}

/** A Pryv epoch-seconds timestamp as a date ("Oct 5, 2026" in English), or "" when absent. */
export function formatDate(ts?: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  return format(new Date(ts * 1000), DATE);
}

/** A Pryv epoch-seconds timestamp as a date and time ("Oct 5, 2026, 3:04:05 PM" in English), or "" when absent. */
export function formatDateTime(ts?: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  return format(new Date(ts * 1000), DATE_TIME);
}
