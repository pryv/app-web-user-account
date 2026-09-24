import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * [DSET] The deployment's settings.json: read once at boot, never fatal, never
 * a blank page, and nothing unsafe taken from it.
 */

import {
  loadDeployedSettings,
  parseDeployedSettings,
  getDefaultServiceInfoUrl,
  getTrustedApiOrigins,
  getLegalSettings,
  getAppCatalogUrl,
  isAllowedServiceInfoUrl,
  _setDeployedSettingsForTest,
  BOOT_FETCH_TIMEOUT_MS,
} from "./deployedSettings";

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch;
}

afterEach(() => {
  _setDeployedSettingsForTest(null);
  vi.useRealTimers();
});

describe("[DSAL] allowed platforms", () => {
  const OWN = "https://reg.example.com/service/info";
  const OTHER = "https://reg.partner.example/service/info";

  it("[DAL1] allows any platform when the deployment sets no list", () => {
    _setDeployedSettingsForTest({ serviceInfoUrl: OWN });
    expect(isAllowedServiceInfoUrl("https://anything.example/service/info")).toBe(true);
    expect(isAllowedServiceInfoUrl("")).toBe(true);
  });

  it("[DAL2] with a list, allows it and the default only, and refuses an undeterminable one", () => {
    _setDeployedSettingsForTest(
      parseDeployedSettings({ serviceInfoUrl: OWN, allowedServiceInfoUrls: [OTHER, "javascript:x"] }),
    );
    expect(isAllowedServiceInfoUrl(OWN)).toBe(true);
    expect(isAllowedServiceInfoUrl(OTHER)).toBe(true);
    expect(isAllowedServiceInfoUrl("https://REG.partner.example/service/info")).toBe(true);
    expect(isAllowedServiceInfoUrl("https://evil.example/service/info")).toBe(false);
    expect(isAllowedServiceInfoUrl("https://reg.example.com/service/info/../x")).toBe(false);
    expect(isAllowedServiceInfoUrl("")).toBe(false);
    expect(isAllowedServiceInfoUrl("javascript:x")).toBe(false);
    expect(isAllowedServiceInfoUrl("https://user@reg.partner.example/service/info")).toBe(false);
    expect(isAllowedServiceInfoUrl(OTHER + "?x=1")).toBe(false);
    expect(isAllowedServiceInfoUrl("https://reg.partner.example:8443/service/info")).toBe(false);
    expect(isAllowedServiceInfoUrl("https://reg.partner.example:443/service/info")).toBe(true);
  });

  it("[DAL3] an empty or all-invalid list means the default platform only, never unrestricted", () => {
    for (const list of [[], ["javascript:x", "not a url"]]) {
      _setDeployedSettingsForTest(parseDeployedSettings({ serviceInfoUrl: OWN, allowedServiceInfoUrls: list }));
      expect(isAllowedServiceInfoUrl(OWN)).toBe(true);
      expect(isAllowedServiceInfoUrl(OTHER)).toBe(false);
    }
    _setDeployedSettingsForTest(parseDeployedSettings({ allowedServiceInfoUrls: [] }));
    expect(isAllowedServiceInfoUrl(OWN)).toBe(false);
  });
});

describe("[DSET] deployed settings", () => {
  it("[DSE1] reads every key from a good file", async () => {
    await loadDeployedSettings(
      respond(200, {
        serviceInfoUrl: "https://reg.example.com/service/info",
        trustedApiOrigins: ["https://core.example.com/some/path", " https://core2.example.com "],
        legal: { terms: { en: "https://example.com/terms" }, privacy: "https://example.com/privacy" },
        appCatalogUrl: "https://assets.example.com/apps/list.json",
      }),
    );
    expect(getDefaultServiceInfoUrl()).toBe("https://reg.example.com/service/info");
    expect(getTrustedApiOrigins()).toEqual(["https://core.example.com", "https://core2.example.com"]);
    expect(getLegalSettings()).toEqual({
      terms: { en: "https://example.com/terms" },
      privacy: "https://example.com/privacy",
    });
    expect(getAppCatalogUrl()).toBe("https://assets.example.com/apps/list.json");
  });

  it("[DSE2] a 404, a malformed body, or a network error leave everything unset", async () => {
    for (const impl of [
      respond(404, {}),
      respond(200, "not json{"),
      (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    ]) {
      _setDeployedSettingsForTest({ serviceInfoUrl: "https://stale.example/service/info" });
      await loadDeployedSettings(impl);
      expect(getDefaultServiceInfoUrl()).toBeNull();
      expect(getTrustedApiOrigins()).toEqual([]);
      expect(getLegalSettings()).toBeNull();
      expect(getAppCatalogUrl()).toBeNull();
    }
  });

  it("[DSE3] a server that never answers does not hold the boot past the cap", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise(() => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
      })) as unknown as typeof fetch;
    const done = loadDeployedSettings(hang);
    await vi.advanceTimersByTimeAsync(BOOT_FETCH_TIMEOUT_MS);
    await done;
    expect(aborted).toBe(true);
    expect(getDefaultServiceInfoUrl()).toBeNull();
  });

  it("[DSE4] drops anything that is not an absolute http(s) URL", () => {
    expect(
      parseDeployedSettings({
        serviceInfoUrl: "javascript:alert(1)",
        trustedApiOrigins: ["data:text/html,x", "/relative", 42, "https://ok.example"],
        legal: { terms: "javascript:alert(1)", privacy: { en: "ftp://x", fr: "https://ok.example/fr" } },
        appCatalogUrl: "//protocol-relative.example/list.json",
      }),
    ).toEqual({
      trustedApiOrigins: ["https://ok.example"],
      legal: { privacy: { fr: "https://ok.example/fr" } },
    });
    expect(
      parseDeployedSettings({
        serviceInfoUrl: "  https://reg.example.com/service/info  ",
        trustedApiOrigins: ["http://core.example.com", "http://localhost:3000"],
      }),
    ).toEqual({
      serviceInfoUrl: "https://reg.example.com/service/info",
      trustedApiOrigins: ["http://localhost:3000"],
    });
    expect(parseDeployedSettings([])).toEqual({});
    expect(parseDeployedSettings(null)).toEqual({});
  });
});
