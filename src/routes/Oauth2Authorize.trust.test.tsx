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
