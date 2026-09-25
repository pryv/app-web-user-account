import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * [PCLI] `src/lib/pryvClient.ts` is the only module importing the Pryv client
 * libraries, so a fork replaces one file to swap the client. Type-only imports
 * count too: they would break the same fork.
 */

const SRC = join(__dirname, "..");
const SPEC = "(?:pryv(?:\\/[^\"'`]*)?|@pryv\\/[^\"'`]+)";
const CLIENT_IMPORT = new RegExp(
  `\\bfrom\\s+["'\`]${SPEC}["'\`]|\\bimport\\s*\\(\\s*["'\`]${SPEC}["'\`]\\s*\\)|\\brequire\\s*\\(\\s*["'\`]${SPEC}["'\`]\\s*\\)|^\\s*import\\s+["'\`]${SPEC}["'\`]`,
  "m",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|js|jsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("[PCLC] cmc export", () => {
  // Guards the export surface only: vitest names CommonJS exports itself, so it
  // passes even with the dev-server bug. [PCL4] and the e2e spec, which runs on
  // the dev server, are the regression tests for that.
  it("[PCL3] exposes the functions the approval pages call", async () => {
    const { cmc } = await import("./pryvClient");
    for (const fn of ["readOffer", "acceptInvite", "refuseInvite", "acceptScopeUpdate", "refuseScopeUpdate"] as const) {
      expect(typeof cmc[fn]).toBe("function");
    }
  });

  it("[PCL4] no package is re-exported with `export *` (the dev server skips CommonJS interop there)", () => {
    // Several client packages are CommonJS (@pryv/cmc, @pryv/delegation,
    // @pryv/socket.io): any bare-specifier `export *` would repeat the bug.
    const source = readFileSync(join(__dirname, "pryvClient.ts"), "utf8");
    expect(source).not.toMatch(/^\s*export\s+\*(\s+as\s+\w+)?\s+from\s+["'][^./]/m);
  });
});

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
    expect(CLIENT_IMPORT.test('import x from "pryv/src/utils";')).toBe(true);
    expect(CLIENT_IMPORT.test("const m = await import(`@pryv/cmc`);")).toBe(true);
    expect(CLIENT_IMPORT.test('const p = require("pryv");')).toBe(true);
    expect(CLIENT_IMPORT.test('import "@pryv/socket.io";')).toBe(true);
    expect(CLIENT_IMPORT.test('import { Pryv } from "./pryvClient";')).toBe(false);
    expect(CLIENT_IMPORT.test('import { x } from "./pryvately";')).toBe(false);
  });
});
