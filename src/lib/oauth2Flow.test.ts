import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
  isTrustedResultOrigin,
  oauth2Accept,
  oauth2Refuse,
  type OAuthFlowError,
} from "./oauth2Flow";

// Full-lexicon offer as the server embeds it in the signed state
// (cherry-picking enabled; one mandatory entry).
const SAMPLE_OFFER = {
  offerName: "study-A",
  capabilityUrl: "https://CapTok@myapp.example.com/",
  capabilityId: "cap-42",
  offerEventId: "ev-offer-1",
  permissions: [
    { streamId: "health", level: "read", defaultName: "Health", mandatory: true },
    { streamId: "diary", level: "contribute" },
    { feature: "selfRevoke", setting: "forbidden" },
  ],
  allowUserChoice: true,
  title: { en: "Example study" },
  description: { en: "Share health data." },
  consent: { en: "I agree to share with the study." },
};

// Helpers --------------------------------------------------------------

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeSignedState(payload: Record<string, unknown> = {}, sig = "fake-mac"): string {
  const body = base64url(
    JSON.stringify({
      clientId: "myapp",
      redirectUri: "https://app.example/cb",
      state: "csrf-1",
      codeChallenge: "cc",
      codeChallengeMethod: "S256",
      scope: ["cmc:study-A"],
      offer: SAMPLE_OFFER,
      iat: 1700000000,
      exp: 1700000300,
      ...payload,
    }),
  );
  return body + "." + sig;
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ----------------------------------------------------------------------

describe("parseOAuthState", () => {
  it("decodes the payload into display fields, including the granular offer", () => {
    const s = parseOAuthState(makeSignedState());
    expect(s.clientId).toBe("myapp");
    expect(s.redirectUri).toBe("https://app.example/cb");
    expect(s.scope).toEqual(["cmc:study-A"]);
    expect(s.offer?.offerName).toBe("study-A");
    expect(s.offer?.permissions).toEqual(SAMPLE_OFFER.permissions);
    expect(s.offer?.title).toEqual({ en: "Example study" });
    expect(s.offer?.consent).toEqual({ en: "I agree to share with the study." });
    expect(s.userIdHint).toBeNull();
    expect(s.iat).toBe(1700000000);
    expect(s.exp).toBe(1700000300);
  });

  it("exposes userIdHint when present", () => {
    const s = parseOAuthState(makeSignedState({ userIdHint: "alice" }));
    expect(s.userIdHint).toBe("alice");
  });

  it("filters non-string entries out of scope and defaults missing fields", () => {
    const s = parseOAuthState(makeSignedState({ scope: ["cmc:study-A", 42, null], clientId: 7 }));
    expect(s.scope).toEqual(["cmc:study-A"]);
    expect(s.clientId).toBe("");
  });

  it("yields offer=null when the state carries none or it is malformed", () => {
    expect(parseOAuthState(makeSignedState({ offer: undefined })).offer).toBeNull();
    expect(parseOAuthState(makeSignedState({ offer: { permissions: [] } })).offer).toBeNull();
    expect(parseOAuthState(makeSignedState({ offer: "junk" })).offer).toBeNull();
  });

  it("allowUserChoice defaults to FALSE (all-or-nothing) when absent", () => {
    const { allowUserChoice: _drop, ...offerNoChoice } = SAMPLE_OFFER;
    const s = parseOAuthState(makeSignedState({ offer: offerNoChoice }));
    expect(s.offer?.allowUserChoice).toBe(false);
  });

  it("throws on empty state", () => {
    expect(() => parseOAuthState("")).toThrow(/required/);
  });

  it("throws on missing signature separator", () => {
    expect(() => parseOAuthState("no-dot-here")).toThrow(/malformed|separator/);
    expect(() => parseOAuthState(".starts-with-dot")).toThrow(/malformed|separator/);
    expect(() => parseOAuthState("ends-with-dot.")).toThrow(/malformed|separator/);
  });

  it("throws on invalid base64 payload", () => {
    expect(() => parseOAuthState("!!!not-base64!!!.sig")).toThrow(/base64/);
  });

  it("throws on non-JSON payload", () => {
    expect(() => parseOAuthState(base64url("not json") + ".sig")).toThrow(/JSON/);
  });

  it("throws when the payload is not an object", () => {
    expect(() => parseOAuthState(base64url('"a string"') + ".sig")).toThrow(/object/);
    expect(() => parseOAuthState(base64url("[1,2]") + ".sig")).toThrow(/object/);
  });
});

describe("serviceInfoUrlFromPryvApi", () => {
  it("appends /reg/service/info, stripping a trailing slash", () => {
    expect(serviceInfoUrlFromPryvApi("https://demo.backloop.dev:2443")).toBe(
      "https://demo.backloop.dev:2443/reg/service/info",
    );
    expect(serviceInfoUrlFromPryvApi("https://demo.backloop.dev:2443/")).toBe(
      "https://demo.backloop.dev:2443/reg/service/info",
    );
  });
});

describe("assertTrustedPryvApi", () => {
  const self = "https://app.example.com";

  it("accepts an allowlisted origin regardless of the self-domain", () => {
    expect(() =>
      assertTrustedPryvApi("https://core.other-tld.net/", {
        trustedOrigins: ["https://core.other-tld.net"],
        selfOrigin: self,
      }),
    ).not.toThrow();
  });

  it("rejects an origin that is not in a configured allowlist", () => {
    expect(() =>
      assertTrustedPryvApi("https://attacker.com/", {
        trustedOrigins: ["https://core.example.com"],
        selfOrigin: self,
      }),
    ).toThrow(/allowlist/);
  });

  it("falls back to same registrable-domain when no allowlist is set", () => {
    expect(() =>
      assertTrustedPryvApi("https://core.example.com/", { selfOrigin: self }),
    ).not.toThrow();
  });

  it("rejects a cross-domain pryvApi with no allowlist (phishing vector)", () => {
    expect(() =>
      assertTrustedPryvApi("https://attacker.com/", { selfOrigin: self }),
    ).toThrow(/cross-domain/);
  });

  it("refuses a non-https pryvApi (except loopback)", () => {
    expect(() => assertTrustedPryvApi("http://core.example.com/", { selfOrigin: self })).toThrow(
      /https/,
    );
    expect(() => assertTrustedPryvApi("http://127.0.0.1:3000/", { selfOrigin: self })).not.toThrow();
  });

  it("throws on a malformed pryvApi", () => {
    expect(() => assertTrustedPryvApi("not a url", { selfOrigin: self })).toThrow(/valid URL/);
  });

  it("fails closed when neither an allowlist nor a self-origin is provided", () => {
    expect(() => assertTrustedPryvApi("https://attacker.com/")).toThrow(/no trusted origin/);
  });

  it("still allows a loopback pryvApi with no trust anchor (local dev)", () => {
    expect(() => assertTrustedPryvApi("http://127.0.0.1:3000/")).not.toThrow();
  });

  it("fails closed in production when no allowlist is configured", () => {
    expect(() =>
      assertTrustedPryvApi("https://core.example.com/", {
        selfOrigin: self,
        requireAllowlist: true,
      }),
    ).toThrow(/allowlist/);
  });

  it("rejects even a loopback pryvApi in production without an allowlist", () => {
    expect(() =>
      assertTrustedPryvApi("http://127.0.0.1:3000/", { requireAllowlist: true }),
    ).toThrow(/allowlist/);
  });

  it("accepts an allowlisted origin in production", () => {
    expect(() =>
      assertTrustedPryvApi("https://core.example.com/", {
        trustedOrigins: ["https://core.example.com"],
        selfOrigin: self,
        requireAllowlist: true,
      }),
    ).not.toThrow();
  });

  it("keeps the registrable-domain fallback for dev builds (no allowlist required)", () => {
    expect(() =>
      assertTrustedPryvApi("https://core.example.com/", {
        selfOrigin: self,
        requireAllowlist: false,
      }),
    ).not.toThrow();
  });
});

describe("isTrustedResultOrigin (token-bearing hand-off gate)", () => {
  const self = "https://app.example.com";

  it("trusts an allowlisted origin, rejects a non-allowlisted one", () => {
    const opts = { trustedOrigins: ["https://app.example.com"], selfOrigin: self, requireAllowlist: true };
    expect(isTrustedResultOrigin("https://app.example.com", opts)).toBe(true);
    expect(isTrustedResultOrigin("https://attacker.example", opts)).toBe(false);
  });

  it("fails CLOSED in production when no allowlist is configured", () => {
    expect(isTrustedResultOrigin("https://app.example.com", { selfOrigin: self, requireAllowlist: true })).toBe(false);
  });

  it("dev fallback: same registrable domain is trusted, cross-domain is not", () => {
    expect(isTrustedResultOrigin("https://core.example.com", { selfOrigin: self })).toBe(true);
    expect(isTrustedResultOrigin("https://attacker.com", { selfOrigin: self })).toBe(false);
  });

  it("trusts loopback in dev, and rejects null / non-http(s) / garbage", () => {
    expect(isTrustedResultOrigin("http://127.0.0.1:3000", {})).toBe(true);
    expect(isTrustedResultOrigin(null, { selfOrigin: self })).toBe(false);
    expect(isTrustedResultOrigin("javascript:alert(1)", { trustedOrigins: ["javascript:alert(1)"] })).toBe(false);
    expect(isTrustedResultOrigin("not a url", { selfOrigin: self })).toBe(false);
  });

  it("the attacker's returnUrl origin is never trusted (the G2 fix)", () => {
    // Even with a legitimate allowlist, a crafted returnUrl origin is refused,
    // so the token-bearing dataGrantApiEndpoint is stripped for it.
    const opts = { trustedOrigins: ["https://app.example.com"], selfOrigin: self, requireAllowlist: true };
    expect(isTrustedResultOrigin("https://attacker.example", opts)).toBe(false);
  });
});

// permissionLabel / pickText / lock semantics are covered in
// `consent.test.ts` — they moved to the shared consent display model.

describe("oauth2Accept", () => {
  const granted = [
    { streamId: "health", level: "read" },
    { feature: "selfRevoke", setting: "forbidden" },
  ];
  const opts = {
    pryvApi: "https://reg.test/",
    signedState: makeSignedState(),
    username: "alice",
    personalToken: "tok-1",
    grantedPermissions: granted,
  };

  it("POSTs state + session + grantedPermissions (full lexicon) and returns redirectTo", async () => {
    const fetchMock = mockFetchOnce(200, { redirectTo: "https://app.example/cb?code=c1" });
    const redirectTo = await oauth2Accept(opts);
    expect(redirectTo).toBe("https://app.example/cb?code=c1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://reg.test/oauth2/authorize/accept");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      state: opts.signedState,
      username: "alice",
      userToken: "tok-1",
      grantedPermissions: granted,
    });
  });

  it("propagates RFC-shaped errors with oauthError + status", async () => {
    mockFetchOnce(400, { error: "invalid_request", error_description: "bad_signature" });
    const err = (await oauth2Accept(opts).catch((e) => e)) as OAuthFlowError;
    expect(err.message).toBe("bad_signature");
    expect(err.oauthError).toBe("invalid_request");
    expect(err.status).toBe(400);
  });

  it("falls back to a generic message on a non-JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error("x")) }),
    );
    const err = (await oauth2Accept(opts).catch((e) => e)) as OAuthFlowError;
    expect(err.message).toMatch(/HTTP 502/);
    expect(err.status).toBe(502);
  });

  it("throws when the server response misses redirectTo", async () => {
    mockFetchOnce(200, {});
    await expect(oauth2Accept(opts)).rejects.toThrow(/redirectTo/);
  });
});

describe("oauth2Refuse", () => {
  it("POSTs the state only and returns redirectTo", async () => {
    const fetchMock = mockFetchOnce(200, {
      redirectTo: "https://app.example/cb?error=access_denied",
    });
    const signedState = makeSignedState();
    const redirectTo = await oauth2Refuse({ pryvApi: "https://reg.test", signedState });
    expect(redirectTo).toBe("https://app.example/cb?error=access_denied");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://reg.test/oauth2/authorize/refuse");
    expect(JSON.parse(init.body)).toEqual({ state: signedState });
  });

  it("propagates RFC-shaped errors", async () => {
    mockFetchOnce(400, { error: "invalid_request" });
    const err = (await oauth2Refuse({ pryvApi: "https://reg.test", signedState: makeSignedState() }).catch(
      (e) => e,
    )) as OAuthFlowError;
    expect(err.message).toBe("invalid_request");
    expect(err.oauthError).toBe("invalid_request");
  });

  it("rejects a missing signedState before any network call", async () => {
    const fetchMock = mockFetchOnce(200, {});
    await expect(oauth2Refuse({ pryvApi: "https://reg.test", signedState: "" })).rejects.toThrow(
      /signedState/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
