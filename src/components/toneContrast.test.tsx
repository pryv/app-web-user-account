// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * [TNCT] The tone colours read below the 4.5:1 text minimum on a light card
 * (info #5bc0de and warning #f0ad4e about 2:1, success #5cb85c about 2.5:1,
 * danger #d9534f about 4:1): they mark frames and icons, never text; red text
 * takes `danger-ink`. Pinned here on the alert itself, and over every source
 * file so a new use on text is caught.
 */

import "../i18n";
import { Alert } from "./ui";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Where a tone colour on `text-` is an icon's: an aria-hidden icon, or an icon-tone table. */
const ICON_ONLY = [/aria-hidden/, /^\s*const iconTone = /, /^\s*(publisherValidated|appValidated): "text-(info|success)",$/];

/** A tone colour on text: `text-danger-ink` is the text token, not the tone. */
const TONE_TEXT = /text-(info|warning|success|danger)(?![\w-])/;

describe("[TNCT] tone colours stay off text", () => {
  afterEach(cleanup);

  it("[TNC3] a danger alert writes its text in the darker danger ink, the tone on its frame", () => {
    const { container } = render(<Alert>Error</Alert>);
    const alert = container.querySelector("[role=alert]")!;
    expect(alert.className).toContain("text-danger-ink");
    expect(alert.className).toContain("border-danger/40");
    expect(TONE_TEXT.test(alert.className)).toBe(false);
  });

  it("[TNC1] an info, warning or success alert writes its text in ink, the colour on its frame and icon", () => {
    for (const tone of ["info", "warning", "success"] as const) {
      const { container } = render(<Alert tone={tone}>Text</Alert>);
      const alert = container.querySelector("[role=alert]")!;
      expect(alert.className).toContain("text-ink");
      expect(alert.className).toContain(`border-${tone}/60`);
      expect(alert.className).not.toContain(`text-${tone}`);
      expect(alert.querySelector("svg")!.getAttribute("class")).toContain(`text-${tone}`);
      cleanup();
    }
  });

  it("[TNC2] no source file puts a tone colour (info, warning, success, danger) on anything but an icon", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (TONE_TEXT.test(line) && !ICON_ONLY.some((ok) => ok.test(line))) {
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
