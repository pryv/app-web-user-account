import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseSsoHash,
  ssoErrorMessage,
  coreOriginFromApiEndpoint,
  ssoProvidersUrl,
  ssoStartUrl,
  fetchSsoProviders,
} from "./ssoLanding";

describe("parseSsoHash", () => {
  it("parses a login result (with and without a leading '#')", () => {
    const expected = { kind: "login", user: "alice", key: "K-123" };
    expect(parseSsoHash("#ssoStatus=login&ssoUser=alice&ssoKey=K-123")).toEqual(expected);
    expect(parseSsoHash("ssoStatus=login&ssoUser=alice&ssoKey=K-123")).toEqual(expected);
  });

  it("parses an mfa result, keeping the method (null when absent)", () => {
    expect(parseSsoHash("#ssoStatus=mfa&ssoUser=bob&ssoMfaToken=T-9&ssoMfaMethod=totp")).toEqual({
      kind: "mfa", user: "bob", mfaToken: "T-9", mfaMethod: "totp",
    });
    expect(parseSsoHash("#ssoStatus=mfa&ssoUser=bob&ssoMfaToken=T-9").kind).toBe("mfa");
    expect((parseSsoHash("#ssoStatus=mfa&ssoUser=bob&ssoMfaToken=T-9") as { mfaMethod: string | null }).mfaMethod).toBeNull();
  });

  it("maps an error fragment to an error outcome", () => {
    expect(parseSsoHash("#ssoError=no-account")).toEqual({ kind: "error", code: "no-account" });
  });

  it("treats a half-formed login/mfa result as a generic failure", () => {
    expect(parseSsoHash("#ssoStatus=login&ssoUser=alice")).toEqual({ kind: "error", code: "sso-failed" });
    expect(parseSsoHash("#ssoStatus=mfa&ssoMfaToken=T")).toEqual({ kind: "error", code: "sso-failed" });
  });

  it("returns 'none' for an empty or unrelated fragment", () => {
    expect(parseSsoHash("").kind).toBe("none");
    expect(parseSsoHash("#other=1").kind).toBe("none");
  });
});

describe("ssoErrorMessage", () => {
  it("has distinct copy for known codes and a fallback", () => {
    expect(ssoErrorMessage("no-account")).toMatch(/linked/i);
    expect(ssoErrorMessage("email-not-verified")).toMatch(/verify/i);
    expect(ssoErrorMessage("sso-failed")).toMatch(/try again/i);
    expect(ssoErrorMessage("something-else")).toMatch(/try again/i);
  });
});

describe("URL helpers", () => {
  it("derives the core origin from a per-user api endpoint", () => {
    expect(coreOriginFromApiEndpoint("https://tok@host.example/alice/")).toBe("https://host.example");
    expect(coreOriginFromApiEndpoint("https://host.example:4443/alice/")).toBe("https://host.example:4443");
  });

  it("builds providers + start URLs (trailing slash tolerant, id encoded)", () => {
    expect(ssoProvidersUrl("https://host.example/")).toBe("https://host.example/auth/sso/providers");
    expect(ssoStartUrl("https://host.example", "google")).toBe("https://host.example/auth/sso/google/start");
    expect(ssoStartUrl("https://host.example", "a b")).toBe("https://host.example/auth/sso/a%20b/start");
  });
});

describe("fetchSsoProviders", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns the provider list on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ providers: [{ id: "google", label: "Google" }] }),
    }));
    expect(await fetchSsoProviders("https://host.example")).toEqual([{ id: "google", label: "Google" }]);
  });

  it("degrades to [] on a non-ok response or a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchSsoProviders("https://host.example")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await fetchSsoProviders("https://host.example")).toEqual([]);
  });
});
