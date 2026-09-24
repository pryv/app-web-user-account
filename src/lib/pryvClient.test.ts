import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * [PCLI] `src/lib/pryvClient.ts` is the only module importing the Pryv client
 * libraries, so a fork replaces one file to swap the client. Type-only imports
 * count too: they would break the same fork.
 */

const SRC = join(__dirname, "..");
const CLIENT_IMPORT = /\bfrom\s+["'](pryv|@pryv\/[^"']+)["']|\bimport\s*\(\s*["'](pryv|@pryv\/[^"']+)["']\s*\)/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("[PCLI] single client import point", () => {
  it("[PCL1] no module other than pryvClient.ts imports pryv or @pryv/*", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => relative(SRC, f) !== join("lib", "pryvClient.ts"))
      .filter((f) => CLIENT_IMPORT.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("[PCL2] the guard does see a direct import", () => {
    expect(CLIENT_IMPORT.test('import Pryv from "pryv";')).toBe(true);
    expect(CLIENT_IMPORT.test("import type { X } from '@pryv/delegation';")).toBe(true);
    expect(CLIENT_IMPORT.test('import { Pryv } from "./pryvClient";')).toBe(false);
  });
});
