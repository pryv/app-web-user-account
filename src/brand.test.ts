import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * [FNTS] Font subsets. A full `@fontsource/<family>/<weight>.css` import ships
 * every script subset (cyrillic, greek, vietnamese, ...), which multiplies the
 * built font files. Only per-subset entry points are allowed here.
 */

// Comments are stripped so an example import in the file header is not counted.
const css = readFileSync(join(__dirname, "brand.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const imports = [...css.matchAll(/@import\s+"(@fontsource\/[^"]+)"/g)].map((m) => m[1]);
const SUBSET_ENTRY = /\/(latin|latin-ext)-\d{3}\.css$/;

describe("[FNTS] brand.css font imports", () => {
  it("[FNT1] imports at least one fontsource face", () => {
    expect(imports.length).toBeGreaterThan(0);
  });

  it("[FNT2] imports only latin / latin-ext per-weight subsets", () => {
    const offending = imports.filter((p) => !SUBSET_ENTRY.test(p));
    expect(
      offending,
      "brand.css must import per-subset files such as \"@fontsource/roboto/latin-400.css\". " +
        "To support another script on purpose, add its subset file (e.g. cyrillic-400.css) " +
        "and extend SUBSET_ENTRY in src/brand.test.ts.",
    ).toEqual([]);
  });
});
