// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * [TNCT] The info and warning colours (#5bc0de, #f0ad4e) read at about 2:1 on a
 * light card: they mark frames and icons, never text. Pinned here on the alert
 * itself, and over every source file so a new use on text is caught.
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
const ICON_ONLY = [/aria-hidden/, /^\s*const iconTone = /, /^\s*publisherValidated: "text-info",$/];

describe("[TNCT] info and warning colours stay off text", () => {
  afterEach(cleanup);

  it("[TNC1] an info or warning alert writes its text in ink, the colour on its frame and icon", () => {
    for (const tone of ["info", "warning"] as const) {
      const { container } = render(<Alert tone={tone}>Text</Alert>);
      const alert = container.querySelector("[role=alert]")!;
      expect(alert.className).toContain("text-ink");
      expect(alert.className).toContain(`border-${tone}/60`);
      expect(alert.className).not.toContain(`text-${tone}`);
      expect(alert.querySelector("svg")!.getAttribute("class")).toContain(`text-${tone}`);
      cleanup();
    }
  });

  it("[TNC2] no source file puts text-info or text-warning on anything but an icon", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/text-(info|warning)\b/.test(line) && !ICON_ONLY.some((ok) => ok.test(line))) {
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
