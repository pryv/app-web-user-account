import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
  oauth2Accept,
  oauth2Refuse,
  oauth2FetchOffer,
  identityNoticeKey,
  endConsentSession,
  isStaleConsentError,
  subjectChangeKey,
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

describe("[OAFR] offer by reference", () => {
  it("[OAFR1] parses offerRef and leaves offer null when the state carries none", () => {
    const st = parseOAuthState(makeSignedState({ offer: undefined, offerRef: { kind: "synthesised", digest: "d1" } }));
    expect(st.offer).toBeNull();
    expect(st.offerRef).toEqual({ kind: "synthesised", digest: "d1" });
    expect(parseOAuthState(makeSignedState()).offerRef).toBeNull();
  });

  it("[OAFR2] fetches the offer and the client display from /oauth2/authorize/offer", async () => {
    const fetchMock = mockFetchOnce(200, {
      client: { clientId: "reg-app", clientName: "Registry app", logoUri: "https://x.example/l.png" },
      offer: { permissions: [{ streamId: "a", level: "read" }], allowUserChoice: false },
    });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com/", signedState: "s.t" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://core.example.com/oauth2/authorize/offer");
    expect(JSON.parse(init.body)).toEqual({ state: "s.t" });
    expect(r.offer.permissions).toEqual([{ streamId: "a", level: "read" }]);
    expect(r.client.name).toBe("Registry app");
    expect(r.client.policyUri).toBeNull();
  });

  it("[OAFR3] surfaces the server's refusal (e.g. the request changed)", async () => {
    mockFetchOnce(400, { error: "invalid_request", error_description: "the consent request changed" });
    const err = (await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" }).catch((e) => e)) as OAuthFlowError;
    expect(err.message).toMatch(/changed/);
    expect(err.oauthError).toBe("invalid_request");
  });

  it("[OAFR4] refuses an answer without a usable offer", async () => {
    mockFetchOnce(200, { offer: { permissions: [] } });
    await expect(oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" })).rejects.toThrow(/no consent offer/);
  });
});

describe("[OAID] which id the app will see", () => {
  it("[OAID1] fetched offers say pseudonym or username; state-carried offers say nothing", async () => {
    mockFetchOnce(200, { offer: { permissions: [{ streamId: "a", level: "read" }], randomAlias: true } });
    const pseudo = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" });
    expect(identityNoticeKey(pseudo.offer)).toBe("oauth.identityPseudonym");
    mockFetchOnce(200, { offer: { permissions: [{ streamId: "a", level: "read" }], randomAlias: false } });
    const plain = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" });
    expect(identityNoticeKey(plain.offer)).toBe("oauth.identityUsername");
    expect(identityNoticeKey(parseOAuthState(makeSignedState()).offer)).toBeNull();
  });
});

describe("[OAEL] entry labels carried by a fetched offer", () => {
  it("[OAEL1] keeps the localized labels, drops malformed ones", async () => {
    mockFetchOnce(200, {
      offer: {
        permissions: [{ streamId: "a", level: "read" }],
        entryLabels: { "s|a|read": { en: "Blood pressure", fr: "Tension" }, "s|b|read": "not a map", "s|c|read": { en: 3 } },
      },
    });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" });
    expect(r.offer.entryLabels).toEqual({ "s|a|read": { en: "Blood pressure", fr: "Tension" } });
  });

  it("[OAEL2] an offer without labels has none", async () => {
    mockFetchOnce(200, { offer: { permissions: [{ streamId: "a", level: "read" }] } });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t" });
    expect(r.offer.entryLabels).toBeNull();
  });
});

describe("[OAES] endConsentSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[OAES1] posts auth/logout on the session's endpoint with its token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    expect(await endConsentSession({ endpoint: "https://core.example.com/alice", token: "tok" })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://core.example.com/alice/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("tok");
  });

  it("[OAES2] never throws: a refusal or a network failure answers false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await endConsentSession({ endpoint: "https://core.example.com/alice/", token: "t" })).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect(await endConsentSession({ endpoint: "https://core.example.com/alice/", token: "t" })).toBe(false);
  });

  it("[OAES3] gives up after the timeout when the core does not answer", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    expect(await endConsentSession({ endpoint: "https://core.example.com/alice/", token: "t", timeoutMs: 20 })).toBe(false);
  });
});

describe("[OACP] composed offer once signed in", () => {
  const OFFER = { permissions: [{ streamId: "a", level: "read", currentlyGranted: true }], allowUserChoice: true };

  it("[OACP1] posts the session with the state and parses the composed answer", async () => {
    const fetchMock = mockFetchOnce(200, {
      offer: OFFER,
      shownDigest: "dig-1",
      currentGrant: { subjectMode: "pseudonym" },
      subjectChange: { from: "pseudonym", to: "account" },
    });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t", username: "alice", userToken: "tok" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ state: "s.t", username: "alice", userToken: "tok" });
    expect(r.composed).toEqual({
      shownDigest: "dig-1",
      currentGrant: { subjectMode: "pseudonym" },
      subjectChange: { from: "pseudonym", to: "account" },
    });
    expect(r.offer.permissions[0]).toEqual({ streamId: "a", level: "read", currentlyGranted: true });
    expect(r.authenticated).toBeNull();
  });

  it("[OACP2] an older core (no shownDigest) yields no composition", async () => {
    mockFetchOnce(200, { offer: OFFER });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t", username: "alice", userToken: "tok" });
    expect(r.composed).toBeNull();
  });

  it("[OACP3] reports a token the core did not accept", async () => {
    mockFetchOnce(200, { offer: OFFER, authenticated: false });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t", username: "alice", userToken: "bad" });
    expect(r.authenticated).toBe(false);
    expect(r.composed).toBeNull();
  });

  it("[OACP4] drops malformed grant and subject-change fields", async () => {
    mockFetchOnce(200, {
      offer: OFFER,
      shownDigest: "dig-2",
      currentGrant: { subjectMode: "other" },
      subjectChange: { from: "account", to: "account" },
    });
    const r = await oauth2FetchOffer({ pryvApi: "https://core.example.com", signedState: "s.t", username: "alice", userToken: "tok" });
    expect(r.composed).toEqual({ shownDigest: "dig-2", currentGrant: null, subjectChange: null });
  });

  it("[OACP5] Accept posts shownDigest and the acknowledgement only when given", async () => {
    const base = { pryvApi: "https://reg.test", signedState: makeSignedState(), username: "alice", personalToken: "t", grantedPermissions: [] };
    let fetchMock = mockFetchOnce(200, { redirectTo: "https://app.example/cb" });
    await oauth2Accept({ ...base, shownDigest: "dig-1", acknowledgeSubjectChange: true });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.shownDigest).toBe("dig-1");
    expect(body.acknowledgeSubjectChange).toBe(true);
    fetchMock = mockFetchOnce(200, { redirectTo: "https://app.example/cb" });
    await oauth2Accept({ ...base, shownDigest: undefined, acknowledgeSubjectChange: false });
    body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect("shownDigest" in body).toBe(false);
    expect("acknowledgeSubjectChange" in body).toBe(false);
  });

  it("[OACP6] recognises the out-of-date refusal, and only that one", async () => {
    const mk = (status: number, oauthError: string, message: string) =>
      Object.assign(new Error(message), { status, oauthError }) as OAuthFlowError;
    expect(isStaleConsentError(mk(400, "invalid_request", "the consent screen is out of date, restart the authorization flow"))).toBe(true);
    expect(isStaleConsentError(mk(400, "invalid_request", "the consent request changed since it was issued, restart the authorization flow"))).toBe(true);
    expect(isStaleConsentError(mk(400, "invalid_request", "the change of identity mode must be acknowledged"))).toBe(false);
    expect(isStaleConsentError(mk(400, "invalid_scope", "the consent screen is out of date"))).toBe(false);
    expect(isStaleConsentError(mk(401, "invalid_request", "out of date"))).toBe(false);
    expect(isStaleConsentError(null)).toBe(false);
  });

  it("[OACP8] reads the core's reason marker first, the wording only when there is none", async () => {
    mockFetchOnce(400, { error: "invalid_request", error_description: "anything", reason: "consent-out-of-date" });
    const base = { pryvApi: "https://reg.test", signedState: makeSignedState(), username: "alice", personalToken: "t", grantedPermissions: [] };
    const stale = (await oauth2Accept(base).catch((e) => e)) as OAuthFlowError;
    expect(stale.reason).toBe("consent-out-of-date");
    expect(isStaleConsentError(stale)).toBe(true);
    // A marker other than out-of-date wins over a wording that would match.
    mockFetchOnce(400, {
      error: "invalid_request",
      error_description: "the consent screen is out of date, restart the authorization flow",
      reason: "subject-change-unacknowledged",
    });
    const unack = (await oauth2Accept(base).catch((e) => e)) as OAuthFlowError;
    expect(unack.reason).toBe("subject-change-unacknowledged");
    expect(isStaleConsentError(unack)).toBe(false);
    // No marker (an older core): the wording decides.
    mockFetchOnce(400, { error: "invalid_request", error_description: "the consent screen is out of date, restart the authorization flow" });
    const legacy = (await oauth2Accept(base).catch((e) => e)) as OAuthFlowError;
    expect(legacy.reason).toBeUndefined();
    expect(isStaleConsentError(legacy)).toBe(true);
  });

  it("[OACP7] picks the subject-change copy by direction", () => {
    expect(subjectChangeKey({ from: "pseudonym", to: "account" })).toBe("oauth.subjectChangeToAccount");
    expect(subjectChangeKey({ from: "account", to: "pseudonym" })).toBe("oauth.subjectChangeToPseudonym");
    expect(subjectChangeKey(null)).toBeNull();
  });
});
