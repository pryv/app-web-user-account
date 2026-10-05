import i18n from "../i18n";

/*
 * Dates as the pages show them: in the page's language (the i18n one, not the
 * browser's), with the month written out, so "5 October" never reads as
 * "10 May" (an all-numeric en date is month first). A language the runtime
 * cannot format in falls back to the browser's, in the same style.
 */

// The month as a short name in every language: `dateStyle: "medium"` would
// still be all-numeric in some (German "05.10.2026").
const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: "numeric", minute: "2-digit" };

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

/** A Pryv epoch-seconds timestamp as a date and time ("Oct 5, 2026, 3:04 PM" in English), or "" when absent. */
export function formatDateTime(ts?: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  return format(new Date(ts * 1000), DATE_TIME);
}
