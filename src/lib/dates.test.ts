import { describe, it, expect } from "vitest";
import i18n from "../i18n";
import { formatDate, formatDateTime } from "./dates";
import { formatSince } from "./delegation";

// 2026-10-05T12:00:00Z: the 5th of October, which an all-numeric en date
// ("10/5/2026") makes read as the 10th of May outside the US.
const OCT_5 = Date.UTC(2026, 9, 5, 12) / 1000;
const NUMERIC_DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;

function withLanguage(lang: string, run: () => void): void {
  const page = i18n as { language: string };
  const before = page.language;
  page.language = lang;
  try {
    run();
  } finally {
    page.language = before;
  }
}

describe("[DATE] dates the pages show", () => {
  it("[DATE1] in English, the month is written out, never an all-numeric date", () => {
    withLanguage("en", () => {
      for (const text of [formatDate(OCT_5), formatSince(OCT_5), formatDateTime(OCT_5)]) {
        expect(text).toMatch(/Oct/);
        expect(text).toMatch(/2026/);
        expect(text).not.toMatch(NUMERIC_DATE);
      }
    });
  });

  it("[DATE2] a language the runtime cannot format in: the browser's language, same style", () => {
    withLanguage("not a tag!", () => {
      expect(formatDate(OCT_5)).toBe(new Date(OCT_5 * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
      expect(formatDate(OCT_5)).not.toMatch(NUMERIC_DATE);
      expect(formatDateTime(OCT_5)).not.toMatch(NUMERIC_DATE);
    });
  });

  it("[DATE3] other languages keep their own order, month written out", () => {
    withLanguage("fr", () => expect(formatDate(OCT_5)).toMatch(/^5 oct\.? 2026$/));
    // German, all-numeric in its "medium" style, also gets the month name.
    withLanguage("de", () => expect(formatDate(OCT_5)).toMatch(/^5\. Okt\.? 2026$/));
  });

  it("[DATE4] nothing to show without a timestamp", () => {
    for (const ts of [undefined, null, Number.NaN]) {
      expect(formatDate(ts)).toBe("");
      expect(formatDateTime(ts)).toBe("");
    }
  });
});
