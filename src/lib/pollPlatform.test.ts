import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * [POLP] Which allowed platform an access request's poll URL belongs to. The
 * poll URL receives the granted token, so a restricted deployment accepts it
 * only from an origin an allowed platform's own service info declares.
 */

import { pollUrlOnPlatform, resolvePollPlatform, _clearPlatformInfoCacheForTest } from "./pollPlatform";
import { _setDeployedSettingsForTest, BOOT_FETCH_TIMEOUT_MS } from "./deployedSettings";

// pryv.me's service info as served on 2026-09-25 (the fields that matter).
const PRYV_ME = {
  access: "https://access.pryv.me/access/",
  api: "https://{username}.pryv.me/",
  register: "https://reg.pryv.me/",
};
const PRYV_ME_URL = "https://reg.pryv.me/service/info";

function serving(bodies: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (!(url in bodies)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(bodies[url]), { status: 200 });
  });
}

afterEach(() => {
  _setDeployedSettingsForTest(null);
  _clearPlatformInfoCacheForTest();
  vi.useRealTimers();
});

describe("[POLO] pollUrlOnPlatform", () => {
  it("[PO01] accepts a core of a DNS-based platform (the reported case)", () => {
    expect(pollUrlOnPlatform("https://core-euc1.pryv.me/reg/access/k1", PRYV_ME)).toBe(true);
  });

  it("[PO02] accepts the register-hosted and access-hosted shapes", () => {
    expect(pollUrlOnPlatform("https://reg.pryv.me/access/k1", PRYV_ME)).toBe(true);
    expect(pollUrlOnPlatform("https://access.pryv.me/access/k1", PRYV_ME)).toBe(true);
    expect(pollUrlOnPlatform("https://reg.pryv.me/reg/access/k1/", PRYV_ME)).toBe(true);
  });

  it("[PO03] refuses hosts outside the platform", () => {
    for (const url of [
      "https://a.b.pryv.me/reg/access/k1",
      "https://pryv.me.evil.example/reg/access/k1",
      "https://evil.example/reg/access/k1",
      "https://evilpryv.me/reg/access/k1",
    ]) {
      expect(pollUrlOnPlatform(url, PRYV_ME), url).toBe(false);
    }
  });

  it("[PO04] refuses plain http except on loopback, and another port", () => {
    expect(pollUrlOnPlatform("http://core-euc1.pryv.me/reg/access/k1", PRYV_ME)).toBe(false);
    expect(pollUrlOnPlatform("https://core-euc1.pryv.me:8443/reg/access/k1", PRYV_ME)).toBe(false);
    const local = { register: "http://localhost:3000/reg/", api: "http://localhost:3000/{username}/" };
    expect(pollUrlOnPlatform("http://localhost:3000/reg/access/k1", local)).toBe(true);
  });

  it("[PO05] refuses anything but a bare access-request path", () => {
    for (const url of [
      // Dot segments resolve before the check; one that leaves the path is refused.
      "https://core-euc1.pryv.me/reg/access/../../other",
      "https://core-euc1.pryv.me/reg/access/%2e%2e%2fother",
      "https://core-euc1.pryv.me/reg/access/k%201",
      "https://core-euc1.pryv.me/reg/access/k1?x=1",
      "https://core-euc1.pryv.me/reg/access/k1#f",
      "https://core-euc1.pryv.me/reg/other/k1",
      "https://core-euc1.pryv.me/reg/access/k1/more",
      "https://user:pw@core-euc1.pryv.me/reg/access/k1",
      "not a url",
    ]) {
      expect(pollUrlOnPlatform(url, PRYV_ME), url).toBe(false);
    }
  });

  it("[PO06] a path-style api names one exact origin; other cores need trustedApiOrigins", () => {
    const info = { register: "https://core.example.com/reg/", api: "https://core.example.com/{username}/" };
    expect(pollUrlOnPlatform("https://core.example.com/reg/access/k1", info)).toBe(true);
    expect(pollUrlOnPlatform("https://x.core.example.com/reg/access/k1", info)).toBe(false);
    expect(pollUrlOnPlatform("https://core2.example.com/reg/access/k1", info)).toBe(false);
    expect(
      pollUrlOnPlatform("https://core2.example.com/reg/access/k1", info, ["https://core2.example.com"]),
    ).toBe(true);
  });

  it("[PO08] host spelling: case-insensitive; trailing dot and the apex refused; [::1] is loopback", () => {
    expect(pollUrlOnPlatform("HTTPS://CORE-EUC1.PRYV.ME/reg/access/k1", PRYV_ME)).toBe(true);
    expect(pollUrlOnPlatform("https://core-euc1.pryv.me./reg/access/k1", PRYV_ME)).toBe(false);
    // The apex is usually the operator's website, not an API host.
    expect(pollUrlOnPlatform("https://pryv.me/reg/access/k1", PRYV_ME)).toBe(false);
    const v6 = { register: "http://[::1]:3000/reg/" };
    expect(pollUrlOnPlatform("http://[::1]:3000/reg/access/k1", v6)).toBe(true);
  });

  it("[PO07] never widens to a bare top-level domain or a mid-host username", () => {
    expect(pollUrlOnPlatform("https://evil.com/reg/access/k1", { api: "https://{username}.com/" })).toBe(false);
    expect(
      pollUrlOnPlatform("https://x.example.com/reg/access/k1", { api: "https://a{username}.example.com/" }),
    ).toBe(false);
  });
});

describe("[PORE] resolvePollPlatform", () => {
  it("[PR01] resolves pryv.me's core poll URL to the allowed service-info URL", async () => {
    _setDeployedSettingsForTest({ allowedServiceInfoUrls: [PRYV_ME_URL] });
    const fetchImpl = serving({ [PRYV_ME_URL]: PRYV_ME });
    const got = await resolvePollPlatform("https://core-euc1.pryv.me/reg/access/k1", null, fetchImpl);
    expect(got).toEqual({ serviceInfoUrl: PRYV_ME_URL, serviceInfo: PRYV_ME });
    // Only the operator-configured URL is read, never the poll host.
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual([PRYV_ME_URL]);
  });

  it("[PR02] returns null when the deployment is not restricted", async () => {
    _setDeployedSettingsForTest({ serviceInfoUrl: PRYV_ME_URL });
    const fetchImpl = serving({ [PRYV_ME_URL]: PRYV_ME });
    expect(await resolvePollPlatform("https://core-euc1.pryv.me/reg/access/k1", null, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("[PR03] a service-info param outside the list is refused without fetching anything", async () => {
    _setDeployedSettingsForTest({ allowedServiceInfoUrls: [PRYV_ME_URL] });
    const fetchImpl = serving({ [PRYV_ME_URL]: PRYV_ME });
    const got = await resolvePollPlatform(
      "https://core-euc1.pryv.me/reg/access/k1",
      "https://reg.evil.example/service/info",
      fetchImpl,
    );
    expect(got).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("[PR04] an allowed service-info param restricts the check to that platform", async () => {
    const OTHER_URL = "https://reg.other.example/service/info";
    _setDeployedSettingsForTest({ serviceInfoUrl: PRYV_ME_URL, allowedServiceInfoUrls: [OTHER_URL] });
    const fetchImpl = serving({
      [PRYV_ME_URL]: PRYV_ME,
      [OTHER_URL]: { register: "https://reg.other.example/", api: "https://{username}.other.example/" },
    });
    // A pryv.me poll URL claimed for the other platform does not belong to it.
    expect(await resolvePollPlatform("https://core-euc1.pryv.me/reg/access/k1", OTHER_URL, fetchImpl)).toBeNull();
    expect(fetchImpl.mock.calls.map((c) => String(c[0]))).toEqual([OTHER_URL]);
    // Without the param, every allowed platform is tried; the default one matches.
    const got = await resolvePollPlatform("https://core-euc1.pryv.me/reg/access/k1", null, fetchImpl);
    expect(got?.serviceInfoUrl).toBe(PRYV_ME_URL);
  });

  it("[PR08] a service-info param spelled differently resolves to the configured spelling", async () => {
    _setDeployedSettingsForTest({ allowedServiceInfoUrls: [PRYV_ME_URL] });
    const fetchImpl = serving({ [PRYV_ME_URL]: PRYV_ME });
    const got = await resolvePollPlatform(
      "https://core-euc1.pryv.me/reg/access/k1",
      "HTTPS://REG.PRYV.ME:443/service/info",
      fetchImpl,
    );
    expect(got?.serviceInfoUrl).toBe(PRYV_ME_URL);
  });

  it("[PR05] unreadable trusted service info refuses (500, non-JSON, not an object)", async () => {
    _setDeployedSettingsForTest({ allowedServiceInfoUrls: [PRYV_ME_URL] });
    const poll = "https://core-euc1.pryv.me/reg/access/k1";
    const status500 = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await resolvePollPlatform(poll, null, status500)).toBeNull();
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await resolvePollPlatform(poll, null, notJson)).toBeNull();
    const array = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(await resolvePollPlatform(poll, null, array)).toBeNull();
  });

  it("[PR06] a hanging trusted service info refuses after the boot timeout", async () => {
    vi.useFakeTimers();
    _setDeployedSettingsForTest({ allowedServiceInfoUrls: [PRYV_ME_URL] });
    const hang = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = resolvePollPlatform("https://core-euc1.pryv.me/reg/access/k1", null, hang);
    await vi.advanceTimersByTimeAsync(BOOT_FETCH_TIMEOUT_MS + 1);
    expect(await pending).toBeNull();
  });

  it("[PR07] trustedApiOrigins admits a core service info does not name", async () => {
    const URL_ = "https://core.example.com/reg/service/info";
    _setDeployedSettingsForTest({
      allowedServiceInfoUrls: [URL_],
      trustedApiOrigins: ["https://core2.example.com"],
    });
    const fetchImpl = serving({
      [URL_]: { register: "https://core.example.com/reg/", api: "https://core.example.com/{username}/" },
    });
    const got = await resolvePollPlatform("https://core2.example.com/reg/access/k1", null, fetchImpl);
    expect(got?.serviceInfoUrl).toBe(URL_);
  });
});
