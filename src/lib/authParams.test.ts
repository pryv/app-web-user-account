import { describe, it, expect } from "vitest";
import {
  parseAuthParams,
  buildCompletionUrl,
  accessRequestSearch,
  hasPendingAccessRequest,
} from "./authParams";

/**
 * [ARQS] A pending access request survives the create-account /
 * reset-password / sign-in hops, so a new user can complete the grant.
 */
describe("[ARQS] access-request context", () => {
  const REQ =
    "?lang=en&key=KEY1&requestingAppId=my-app" +
    "&poll=https%3A%2F%2Fcore.example%2Freg%2Faccess%2FKEY1" +
    "&poll_rate_ms=1000&serviceInfo=https%3A%2F%2Fcore.example%2Freg%2Fservice%2Finfo" +
    "&returnURL=https%3A%2F%2Fapp.test%2F";

  it("[ARQS1] keeps poll, key, serviceInfo and lang", () => {
    const p = new URLSearchParams(accessRequestSearch(REQ));
    expect(p.get("poll")).toBe("https://core.example/reg/access/KEY1");
    expect(p.get("key")).toBe("KEY1");
    expect(p.get("serviceInfo")).toBe("https://core.example/reg/service/info");
    expect(p.get("lang")).toBe("en");
  });

  it("[ARQS2] drops requestingAppId, returnURL, state and params outside the request context", () => {
    const p = new URLSearchParams(accessRequestSearch(REQ + "&state=csrf&other=1"));
    expect(p.get("requestingAppId")).toBeNull();
    expect(p.get("returnURL")).toBeNull();
    expect(p.get("state")).toBeNull();
    expect(p.get("other")).toBeNull();
    expect(p.get("poll_rate_ms")).toBeNull();
  });

  it("[ARQS3] returns '' without a pending request", () => {
    expect(accessRequestSearch("?pryvServiceInfoUrl=https%3A%2F%2Fx.test%2Finfo")).toBe("");
    expect(accessRequestSearch("")).toBe("");
  });

  it("[ARQS4] hasPendingAccessRequest keys on the poll URL only", () => {
    expect(hasPendingAccessRequest(REQ)).toBe(true);
    expect(hasPendingAccessRequest("?pollUrl=https%3A%2F%2Fx.test%2Fa")).toBe(true);
    expect(hasPendingAccessRequest("?key=abc&requestingAppId=x")).toBe(false);
    expect(hasPendingAccessRequest("?poll=&pollUrl=https%3A%2F%2Fx.test%2Fa")).toBe(true);
    expect(hasPendingAccessRequest("")).toBe(false);
  });
});

describe("parseAuthParams", () => {
  it("extracts pryvServiceInfoUrl, requestingAppId, returnURL, state", () => {
    const p = parseAuthParams(
      "?pryvServiceInfoUrl=https%3A%2F%2Freg.pryv.me%2Fservice%2Finfo&requestingAppId=my-app&returnURL=https%3A%2F%2Fapp.test%2Fcb&state=abc",
    );
    expect(p.serviceInfoUrl).toBe("https://reg.pryv.me/service/info");
    expect(p.appId).toBe("my-app");
    expect(p.returnURL).toBe("https://app.test/cb");
    expect(p.state).toBe("abc");
  });

  it("falls back to the default appId when not provided", () => {
    expect(parseAuthParams("").appId).toBe("pryv-user-account");
  });

  it("returns null for unknown params", () => {
    const p = parseAuthParams("");
    expect(p.serviceInfoUrl).toBeNull();
    expect(p.returnURL).toBeNull();
    expect(p.state).toBeNull();
    expect(p.username).toBeNull();
  });

  it("[SIUH1] reads the username sign-in hint, trimmed, empty as null", () => {
    expect(parseAuthParams("?username=alice").username).toBe("alice");
    expect(parseAuthParams("?username=%20bob%20").username).toBe("bob");
    expect(parseAuthParams("?username=").username).toBeNull();
    expect(parseAuthParams("?username=%20").username).toBeNull();
  });
});

describe("buildCompletionUrl", () => {
  it("appends pryvApiEndpoint and reflects state", () => {
    const out = buildCompletionUrl(
      "https://app.test/cb",
      "https://user.pryv.me/",
      "csrf-state",
    );
    const u = new URL(out);
    expect(u.origin + u.pathname).toBe("https://app.test/cb");
    expect(u.searchParams.get("state")).toBe("csrf-state");
    expect(u.searchParams.get("pryvApiEndpoint")).toBe("https://user.pryv.me/");
  });

  it("omits state when none provided", () => {
    const out = buildCompletionUrl(
      "https://app.test/cb",
      "https://user.pryv.me/",
      null,
    );
    const u = new URL(out);
    expect(u.searchParams.has("state")).toBe(false);
    expect(u.searchParams.get("pryvApiEndpoint")).toBe("https://user.pryv.me/");
  });

  it("preserves existing query params on the returnURL", () => {
    const out = buildCompletionUrl(
      "https://app.test/cb?foo=bar",
      "https://user.pryv.me/",
      "s",
    );
    const u = new URL(out);
    expect(u.searchParams.get("foo")).toBe("bar");
    expect(u.searchParams.get("state")).toBe("s");
    expect(u.searchParams.get("pryvApiEndpoint")).toBe("https://user.pryv.me/");
  });

  it("does NOT include any long-term token in the URL", () => {
    // The caller is responsible for passing the bare endpoint (without token);
    // this test is a guard against future code accidentally including one.
    const out = buildCompletionUrl(
      "https://app.test/cb",
      "https://user.pryv.me/",
      null,
    );
    expect(out).not.toMatch(/@user\.pryv\.me/);
  });

  it("rejects a javascript:-scheme returnURL (XSS in the auth origin)", () => {
    expect(() =>
      buildCompletionUrl("javascript:alert(document.domain)", "https://user.pryv.me/", null),
    ).toThrow();
  });

  it("rejects a data:-scheme returnURL", () => {
    expect(() =>
      buildCompletionUrl("data:text/html,<script>alert(1)</script>", "https://user.pryv.me/", null),
    ).toThrow();
  });

  it("rejects a relative / non-absolute returnURL", () => {
    expect(() => buildCompletionUrl("/relative/cb", "https://user.pryv.me/", null)).toThrow();
  });

  it("allows an http returnURL (local dev over http is common)", () => {
    const out = buildCompletionUrl("http://localhost:8080/cb", "https://user.pryv.me/", null);
    expect(out).toMatch(/^http:\/\/localhost:8080\/cb\?/);
  });
});
