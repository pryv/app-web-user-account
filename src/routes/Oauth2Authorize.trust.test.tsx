// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Oauth2Authorize from "./Oauth2Authorize";
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";

/**
 * [OATR] The consent page sends the user's password and personal token to
 * `pryvApi`, so it must only accept a core the operator trusts. The trust list
 * set in settings.json counts exactly like the build-time one; an origin in
 * neither is refused before any sign-in form is shown.
 */

const ENV = "VITE_OAUTH_TRUSTED_API_ORIGINS";
// Cross-domain from the test page, so the same-domain fallback cannot accept it.
const RUNTIME_CORE = "https://core.other-tld.net";
const UNLISTED_CORE = "https://attacker.example";

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const SIGNED_STATE =
  base64url(
    JSON.stringify({
      clientId: "myapp",
      redirectUri: "https://app.example/cb",
      state: "csrf-1",
      scope: ["cmc:study-A"],
      offer: {
        offerName: "study-A",
        permissions: [{ streamId: "diary", level: "read" }],
        allowUserChoice: false,
      },
      iat: 1700000000,
      exp: 1700000300,
    }),
  ) + ".fake-mac";

function renderAt(pryvApi: string) {
  const search = `?state=${encodeURIComponent(SIGNED_STATE)}&pryvApi=${encodeURIComponent(pryvApi + "/")}`;
  render(
    <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
      <Oauth2Authorize />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  _setDeployedSettingsForTest(null);
});

describe("[OATR] Oauth2Authorize trusted pryvApi", () => {
  it("[OAT1] accepts a pryvApi listed only in settings.json", () => {
    vi.stubEnv(ENV, "");
    _setDeployedSettingsForTest({ trustedApiOrigins: [RUNTIME_CORE] });
    renderAt(RUNTIME_CORE);
    expect(document.getElementById("oauthInitError")).toBeNull();
    expect(document.getElementById("oauthAppPrompt")).not.toBeNull();
  });

  it("[OAT2] accepts it in a production build too (the runtime list satisfies the allowlist requirement)", () => {
    vi.stubEnv(ENV, "");
    vi.stubEnv("PROD", true);
    _setDeployedSettingsForTest({ trustedApiOrigins: [RUNTIME_CORE] });
    renderAt(RUNTIME_CORE);
    expect(document.getElementById("oauthInitError")).toBeNull();
    expect(document.getElementById("oauthAppPrompt")).not.toBeNull();
  });

  it("[OAT3] refuses a pryvApi absent from both lists", () => {
    vi.stubEnv(ENV, "https://core.example.com");
    _setDeployedSettingsForTest({ trustedApiOrigins: [RUNTIME_CORE] });
    renderAt(UNLISTED_CORE);
    expect(screen.getByText(/not in the trusted allowlist/)).toBeTruthy();
    expect(document.getElementById("oauthAppPrompt")).toBeNull();
  });

  it("[OAT4] refuses the cross-domain core when no list names it", () => {
    vi.stubEnv(ENV, "");
    renderAt(RUNTIME_CORE);
    expect(document.getElementById("oauthInitError")).not.toBeNull();
    expect(document.getElementById("oauthAppPrompt")).toBeNull();
  });

  it("[OAT5] a production build with neither list fails closed", () => {
    vi.stubEnv(ENV, "");
    vi.stubEnv("PROD", true);
    renderAt(RUNTIME_CORE);
    expect(screen.getByText(/production requires an explicit allowlist/)).toBeTruthy();
  });
});

describe("[OAFB] Oauth2Authorize with an offer by reference", () => {
  function stateWith(extra: Record<string, unknown>): string {
    return base64url(JSON.stringify({
      clientId: "reg-app", redirectUri: "http://192.168.1.10:8080/cb", state: "c", scope: ["data/a.read"],
      iat: 1700000000, exp: 1700000300, ...extra,
    })) + ".fake-mac";
  }
  function renderState(state: string) {
    const search = `?state=${encodeURIComponent(state)}&pryvApi=${encodeURIComponent(RUNTIME_CORE + "/")}`;
    render(
      <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
        <Oauth2Authorize />
      </MemoryRouter>,
    );
  }

  it("[OAFB1] a state with offerRef reaches the sign-in step and fetches the offer", async () => {
    vi.stubEnv(ENV, "");
    _setDeployedSettingsForTest({ trustedApiOrigins: [RUNTIME_CORE] });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ client: { clientName: "Registry app" }, offer: { permissions: [{ streamId: "a", level: "read" }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderState(stateWith({ offerRef: { kind: "synthesised", digest: "d" } }));
    expect(document.getElementById("oauthInitError")).toBeNull();
    expect(document.getElementById("oauthAppPrompt")).not.toBeNull();
    await screen.findByText("Registry app");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/oauth2/authorize/offer"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("[OAFB2] a state with neither an offer nor a reference is refused", () => {
    vi.stubEnv(ENV, "");
    _setDeployedSettingsForTest({ trustedApiOrigins: [RUNTIME_CORE] });
    renderState(stateWith({}));
    expect(document.getElementById("oauthInitError")).not.toBeNull();
  });
});
