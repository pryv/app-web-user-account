// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * [SSRT] The return context that survives a third-party sign-in.
 *
 * Two properties carry the weight here. The first is that only the
 * allow-listed, non-secret keys ever leave for the core: the start URL is a
 * GET and is written to the core's request log, so a capability URL or a
 * session token riding it would be a leak. The second is the trust anchor:
 * `pryvServiceInfoUrl` decides which core the one-time sign-in key is redeemed
 * against, so the landing page's own value must win over anything a crafted
 * start link put in the return context.
 */

import {
  buildSsoReturn,
  stashSsoReturn,
  restoreSsoReturn,
  ssoReturnFromHash,
} from "./ssoReturn";
import { ssoStartUrl } from "./ssoLanding";
import { parseSsoHash } from "./ssoLanding";
import { handoffReturnPath } from "./handoffReturn";

const REAL_SI = "https://real.example/reg/service/info";
const EVIL_SI = "https://evil.example/reg/service/info";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[SSRT] SSO return context", () => {
  it("[SSRT1] carries only the allow-listed keys, never a credential", () => {
    const search =
      "?returnURL=https%3A%2F%2Fapp.example%2Fcb&state=abc&requestingAppId=my-app" +
      "&next=%2Fcmc-accept" +
      `&pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}` +
      "&capabilityUrl=https%3A%2F%2Fcore%2Fabc-secret&mfaToken=mt&token=tk";
    const { value } = buildSsoReturn(search);
    expect(value).not.toBeNull();
    const carried = new URLSearchParams(value!);

    expect(carried.get("returnURL")).toBe("https://app.example/cb");
    expect(carried.get("state")).toBe("abc");
    expect(carried.get("requestingAppId")).toBe("my-app");
    expect(carried.get("next")).toBe("/cmc-accept");
    expect(carried.get("h")).toBeTruthy();

    for (const secret of ["pryvServiceInfoUrl", "capabilityUrl", "mfaToken", "token"]) {
      expect(carried.get(secret)).toBeNull();
    }
    expect(value).not.toContain("abc-secret");
  });

  it("[SSRT1B] stays inside the alphabet the core accepts", () => {
    const { value } = buildSsoReturn(
      "?returnURL=https%3A%2F%2Fapp.example%2Fcb%3Fa%3D1%26b%3D2&state=a b%22c%23d",
    );
    expect(value).not.toBeNull();
    // The core refuses anything outside this set with a 400.
    expect(value!).toMatch(/^[A-Za-z0-9*._%+=&-]*$/);
  });

  it("[SSRT2] drops a returnURL that could never be navigated to", () => {
    for (const bad of ["javascript:alert(1)", "/relative/path", "data:text/html,x"]) {
      const { value } = buildSsoReturn(`?returnURL=${encodeURIComponent(bad)}&state=s`);
      expect(new URLSearchParams(value ?? "").get("returnURL")).toBeNull();
    }
  });

  it("[SSRT3] gives up on an oversize subset rather than sending a value the core refuses", () => {
    const huge = "https://app.example/cb?x=" + "y".repeat(2100);
    const { value, nonce } = buildSsoReturn(`?returnURL=${encodeURIComponent(huge)}`);
    expect(value).toBeNull();
    expect(nonce).toBeTruthy(); // the stash still works
  });

  it("[SSRT4] sends nothing when there is nothing to carry (no bare nonce)", () => {
    expect(buildSsoReturn("").value).toBeNull();
    expect(buildSsoReturn(`?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`).value).toBeNull();
  });

  it("[SSRT5] the landing page's pryvServiceInfoUrl always wins (trust anchor)", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;

    // From the core-carried subset.
    const fromSubset = restoreSsoReturn(
      `returnURL=https%3A%2F%2Fapp.example%2Fcb&pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`,
      landing,
    );
    expect(new URLSearchParams(fromSubset).get("pryvServiceInfoUrl")).toBe(REAL_SI);
    expect(fromSubset).not.toContain("evil.example");

    // And from the stash.
    const { nonce } = buildSsoReturn("?returnURL=https%3A%2F%2Fapp.example%2Fcb");
    stashSsoReturn(nonce, `?pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}&state=s`);
    const fromStash = restoreSsoReturn(`state=s&h=${nonce}`, landing);
    expect(new URLSearchParams(fromStash).get("pryvServiceInfoUrl")).toBe(REAL_SI);
    expect(fromStash).not.toContain("evil.example");
  });

  it("[SSRT5B] the service-info URL is REMOVED, not merely outranked by the landing query", () => {
    // [SSRT5] alone cannot see this: there the landing carries its own anchor,
    // so the landing-wins merge rule masks whether the value was ever dropped.
    // A landing URL without the anchor is what exposes it, and that case is
    // live: SsoLanding hands the restored query to /mfa-challenge, which
    // resolves its service from it.
    for (const landing of ["", "?foo=1"]) {
      const fromSubset = restoreSsoReturn(
        `state=s&pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`,
        landing,
      );
      expect(new URLSearchParams(fromSubset).get("pryvServiceInfoUrl")).toBeNull();

      stashSsoReturn("n1", `?state=s&pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`);
      const fromStash = restoreSsoReturn(`state=s&h=n1`, landing);
      expect(new URLSearchParams(fromStash).get("pryvServiceInfoUrl")).toBeNull();
    }
  });

  it("[SSRT1C] only the allow-listed keys survive the trip through the core", () => {
    // The core is handed an opaque string; whatever else a crafted start link
    // puts in it must not reappear in the query the app then acts on.
    const restored = restoreSsoReturn(
      "state=s&backUrl=https%3A%2F%2Fevil.example&capabilityUrl=https%3A%2F%2Fevil%2Fcap&foo=bar",
      "",
    );
    const q = new URLSearchParams(restored);
    expect(q.get("state")).toBe("s");
    for (const key of ["backUrl", "capabilityUrl", "foo"]) {
      expect(q.get(key)).toBeNull();
    }
    // The stash is the full-fidelity layer and is deliberately not filtered:
    // it is this tab's own query, which is how capabilityUrl gets home.
    stashSsoReturn("n1", "?capabilityUrl=https%3A%2F%2Fcore%2Fcap&next=%2Fcmc-accept");
    const viaStash = new URLSearchParams(restoreSsoReturn("next=%2Fcmc-accept&h=n1", ""));
    expect(viaStash.get("capabilityUrl")).toBe("https://core/cap");
  });

  it("[SSRT6] a matching stash restores the full query, a mismatched one does not, and both consume it", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    const full = "?next=%2Fcmc-accept&capabilityUrl=https%3A%2F%2Fcore%2Fcap-secret&mode=popup";

    stashSsoReturn("n1", full);
    const matched = new URLSearchParams(restoreSsoReturn("next=%2Fcmc-accept&h=n1", landing));
    expect(matched.get("capabilityUrl")).toBe("https://core/cap-secret");
    expect(matched.get("mode")).toBe("popup");
    expect(sessionStorage.getItem("pryv.sso.return")).toBeNull();

    stashSsoReturn("n1", full);
    const mismatched = new URLSearchParams(restoreSsoReturn("next=%2Fcmc-accept&h=OTHER", landing));
    expect(mismatched.get("capabilityUrl")).toBeNull();
    expect(mismatched.get("next")).toBe("/cmc-accept");
    expect(sessionStorage.getItem("pryv.sso.return")).toBeNull();
  });

  it("[SSRT7] a stash older than the round-trip window is ignored", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    const now = 1_000_000_000;
    stashSsoReturn("n1", "?capabilityUrl=https%3A%2F%2Fcore%2Fcap", now);
    const restored = restoreSsoReturn("h=n1&state=s", landing, now + 600_001);
    expect(new URLSearchParams(restored).get("capabilityUrl")).toBeNull();
  });

  it("[SSRT8] an older core that echoes nothing still completes a same-tab return", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    stashSsoReturn("n1", "?returnURL=https%3A%2F%2Fapp.example%2Fcb&state=s");
    const withStash = new URLSearchParams(restoreSsoReturn(null, landing));
    expect(withStash.get("returnURL")).toBe("https://app.example/cb");
    expect(withStash.get("state")).toBe("s");

    // Nothing at all: the landing page's own query, unchanged.
    expect(restoreSsoReturn(null, landing)).toBe(landing);
  });

  it("[SSRT9] a restored next is still matched exactly, so it cannot redirect elsewhere", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    for (const next of ["/evil", "https://evil.example/cmc-accept", "/cmc-accept-x"]) {
      const restored = restoreSsoReturn(`next=${encodeURIComponent(next)}`, landing);
      expect(handoffReturnPath(restored)).toBeNull();
    }
    expect(handoffReturnPath(restoreSsoReturn("next=%2Fcmc-accept", landing))).toContain("/cmc-accept");
  });

  it("[SSRT9B] a restored returnURL that is not http(s) is dropped", () => {
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    const restored = restoreSsoReturn(
      `returnURL=${encodeURIComponent("javascript:alert(1)")}&state=s`,
      landing,
    );
    expect(new URLSearchParams(restored).get("returnURL")).toBeNull();
    expect(new URLSearchParams(restored).get("state")).toBe("s");
  });

  it("[SSRT10] unusable storage degrades to the core-carried subset instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;

    expect(() => stashSsoReturn("n1", "?state=s")).not.toThrow();
    const restored = restoreSsoReturn("state=s&h=n1", landing);
    expect(new URLSearchParams(restored).get("state")).toBe("s");
  });

  it("[SSRT11] ssoStartUrl appends the value encoded once, and omits it when absent", () => {
    const value = "returnURL=https%3A%2F%2Fapp.example%2Fcb&state=abc";
    const url = ssoStartUrl("https://core.example", "google", value);
    expect(new URL(url).pathname).toBe("/auth/sso/google/start");
    expect(new URL(url).searchParams.get("ssoReturn")).toBe(value);

    expect(ssoStartUrl("https://core.example", "google")).toBe(
      "https://core.example/auth/sso/google/start",
    );
    expect(ssoStartUrl("https://core.example", "google", null)).toBe(
      "https://core.example/auth/sso/google/start",
    );
  });

  it("[SSRT12] the existing fragment parser is unaffected by the extra key", () => {
    const hash = "#ssoStatus=login&ssoUser=alice&ssoKey=k1&ssoReturn=state%3Dabc";
    expect(parseSsoHash(hash)).toEqual({ kind: "login", user: "alice", key: "k1" });
    expect(ssoReturnFromHash(hash)).toBe("state=abc");
    expect(ssoReturnFromHash("#ssoStatus=login&ssoUser=a&ssoKey=k")).toBeNull();
  });

  it("[SSRT13] round-trips a real auth-flow start through build and restore", () => {
    const appSearch =
      "?returnURL=https%3A%2F%2Fapp.example%2Fcb&state=csrf-1&requestingAppId=my-app" +
      `&pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    const { value, nonce } = buildSsoReturn(appSearch);
    stashSsoReturn(nonce, appSearch);

    const landing = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
    const restored = new URLSearchParams(restoreSsoReturn(value, landing));
    expect(restored.get("returnURL")).toBe("https://app.example/cb");
    expect(restored.get("state")).toBe("csrf-1");
    expect(restored.get("requestingAppId")).toBe("my-app");
    expect(restored.get("pryvServiceInfoUrl")).toBe(REAL_SI);
  });
});
