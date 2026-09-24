import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAppCatalog,
  localizeCatalogText,
  parseCatalog,
  resetAppCatalog,
  resolveRequestingApp,
  MAX_CATALOG_CHARS,
  MAX_ICON_CHARS,
} from "./appCatalog";
import { _setDeployedSettingsForTest } from "./deployedSettings";

// The catalog is the anti-spoofing control on the consent screen, so these
// tests care as much about what it REFUSES as about what it resolves.

const DIARY = {
  id: "diary-app",
  name: "Diary",
  description: { en: "Personal diary", fr: "Journal personnel" },
  icon: { type: "base64", value: "data:image/png;base64,AAA=" },
  provider: "Example Inc.",
};

function file(apps: unknown[], schemaVersion: unknown = 1) {
  return { schemaVersion, version: "test", apps };
}

function iconOf(icon: unknown) {
  return parseCatalog(file([{ ...DIARY, icon }])).get("diary-app")?.icon;
}

describe("[APCP] parseCatalog", () => {
  it("[APC1] indexes well-formed entries by id", () => {
    const c = parseCatalog(file([DIARY]));
    expect(c.size).toBe(1);
    expect(c.get("diary-app")?.name).toBe("Diary");
    expect(c.get("diary-app")?.provider).toBe("Example Inc.");
  });

  it("[APC2] refuses a schemaVersion newer than it understands", () => {
    expect(parseCatalog(file([DIARY], 2)).size).toBe(0);
  });

  it("[APC3] accepts an older/equal schemaVersion", () => {
    expect(parseCatalog(file([DIARY], 1)).size).toBe(1);
  });

  it("[APC4] drops malformed entries but keeps the good ones", () => {
    const c = parseCatalog(file([{ id: "no-name" }, { name: "no id" }, null, "nonsense", DIARY]));
    expect([...c.keys()]).toEqual(["diary-app"]);
  });

  it("[APC5] returns empty for a file that is not a catalog", () => {
    for (const bad of [null, undefined, 42, "x", {}, { schemaVersion: 1 }, file("nope" as never)]) {
      expect(parseCatalog(bad).size).toBe(0);
    }
  });

  it("[APC6] keeps only identity fields: hooks and the rest are not carried", () => {
    const c = parseCatalog(file([{ ...DIARY, hook: { open: { url: "https://x" } } }]));
    expect(c.get("diary-app")).not.toHaveProperty("hook");
  });
});

describe("[APCI] icon validation", () => {
  it("[API1] keeps an emoji, an https URL and a raster image data URL", () => {
    expect(iconOf({ type: "emoji", value: "📓" })).toEqual({ type: "emoji", value: "📓" });
    expect(iconOf({ type: "url", value: "https://assets.test/i.png" })?.value).toBe(
      "https://assets.test/i.png",
    );
    expect(iconOf({ type: "base64", value: "data:image/webp;base64,UklGRg==" })?.type).toBe("base64");
  });

  it("[API2] refuses an icon type it does not know", () => {
    expect(iconOf({ type: "svg", value: "<svg/>" })).toBeUndefined();
  });

  it("[API3] refuses a url icon that is not http(s)", () => {
    for (const value of ["javascript:alert(1)", "data:image/png;base64,AAA=", "/relative.png", "ftp://x/i.png"]) {
      expect(iconOf({ type: "url", value })).toBeUndefined();
    }
  });

  it("[API4] refuses a base64 icon that is not a raster image data URL", () => {
    for (const value of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
      "AAAA",
      "https://assets.test/i.png",
      "data:image/png;base64,AA A=",
    ]) {
      expect(iconOf({ type: "base64", value })).toBeUndefined();
    }
  });

  it("[API5] refuses an oversized icon, keeping the entry", () => {
    const big = "data:image/png;base64," + "A".repeat(MAX_ICON_CHARS.base64);
    const c = parseCatalog(file([{ ...DIARY, icon: { type: "base64", value: big } }]));
    expect(c.get("diary-app")?.name).toBe("Diary");
    expect(c.get("diary-app")?.icon).toBeUndefined();
    expect(iconOf({ type: "emoji", value: "x".repeat(MAX_ICON_CHARS.emoji + 1) })).toBeUndefined();
  });
});

describe("[APCL] localizeCatalogText", () => {
  it("[APL1] prefers the active language, falling back to en", () => {
    const d = { en: "Personal diary", fr: "Journal personnel" };
    expect(localizeCatalogText(d, "fr")).toBe("Journal personnel");
    expect(localizeCatalogText(d, "fr-CH")).toBe("Journal personnel");
    expect(localizeCatalogText(d, "es")).toBe("Personal diary");
    expect(localizeCatalogText(undefined, "fr")).toBeNull();
  });

  it("[APL2] treats an empty string as absent", () => {
    expect(localizeCatalogText({ en: "En", fr: "" }, "fr")).toBe("En");
    expect(localizeCatalogText({ en: "" }, "en")).toBeNull();
  });
});

describe("[APCR] resolveRequestingApp", () => {
  const catalog = parseCatalog(file([DIARY]));

  it("[APR1] resolves a known id to the curated identity", () => {
    expect(resolveRequestingApp(catalog, "diary-app", "fr")).toEqual({
      name: "Diary",
      description: "Journal personnel",
      icon: { type: "base64", value: "data:image/png;base64,AAA=" },
    });
  });

  it("[APR2] returns null for an id the operator has not published", () => {
    expect(resolveRequestingApp(catalog, "other-app", "en")).toBeNull();
  });

  it("[APR3] returns null for a missing/empty app id", () => {
    expect(resolveRequestingApp(catalog, null, "en")).toBeNull();
    expect(resolveRequestingApp(catalog, undefined, "en")).toBeNull();
    expect(resolveRequestingApp(catalog, "", "en")).toBeNull();
  });
});

describe("[APCF] getAppCatalog", () => {
  const SVC = "https://core.test/service/info";
  const URL_ = "https://assets.test/apps/list.json";
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAppCatalog();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    warn.mockRestore();
    _setDeployedSettingsForTest(null);
  });

  it("[APF1] no appCatalogUrl: empty catalog, no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await getAppCatalog(SVC)).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[APF2] fetches the configured URL once, without credentials", async () => {
    _setDeployedSettingsForTest({ appCatalogUrl: URL_ });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(file([DIARY]))));
    vi.stubGlobal("fetch", fetchSpy);
    expect((await getAppCatalog(SVC)).get("diary-app")?.name).toBe("Diary");
    await getAppCatalog(SVC);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]).toEqual([URL_, expect.objectContaining({ credentials: "omit" })]);
  });

  it("[APF3] a network failure or an HTTP error yields an empty catalog", async () => {
    _setDeployedSettingsForTest({ appCatalogUrl: URL_ });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect((await getAppCatalog(SVC)).size).toBe(0);
    resetAppCatalog();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await getAppCatalog(SVC)).size).toBe(0);
    resetAppCatalog();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{not json")));
    expect((await getAppCatalog(SVC)).size).toBe(0);
  });

  it("[APF4] an oversized file yields an empty catalog", async () => {
    _setDeployedSettingsForTest({ appCatalogUrl: URL_ });
    const body = JSON.stringify(file([DIARY])) + " ".repeat(MAX_CATALOG_CHARS);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    expect((await getAppCatalog(SVC)).size).toBe(0);
  });

  it("[APF5] a server that never answers is abandoned after the timeout", async () => {
    vi.useFakeTimers();
    _setDeployedSettingsForTest({ appCatalogUrl: URL_ });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const pending = getAppCatalog(SVC);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).size).toBe(0);
  });
});
