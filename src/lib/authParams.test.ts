import { describe, it, expect } from "vitest";
import { parseAuthParams, buildCompletionUrl } from "./authParams";

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
});
