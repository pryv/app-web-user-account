// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [OASS] The consent page's own personal session: it signs in with this app's
 * appId (never the client id), and the session it opened ends once Accept or
 * Reject is answered. A session this app keeps open in this browser, which
 * the core hands back for the same appId, is left alone; a failure to end the
 * session never holds back the redirect.
 *
 * [OALB] Row labels: the offer's own entry labels name streams that do not
 * exist in the account yet; existing streams fall back to the account's name.
 */

const loginMock = vi.hoisted(() => ({
  login: vi.fn(),
  api: vi.fn(),
}));

vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  class FakeService {
    login(username: string, password: string, appId: string) {
      return loginMock.login(username, password, appId);
    }
    mfaChallenge() { return Promise.resolve(); }
    mfaVerify() { return Promise.resolve(); }
  }
  return { ...actual, Pryv: { ...actual.Pryv, Service: FakeService } };
});

const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("../lib/returnTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/returnTarget")>()),
  navigateTo: nav.navigateTo,
}));

import Oauth2Authorize from "./Oauth2Authorize";
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";
import { ACCOUNT_APP_ID } from "../lib/accountApp";

const CORE = "https://core.other-tld.net";
const ENDPOINT = CORE + "/alice/";
const TOKEN = "consent-tok";

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function stateWith(extra: Record<string, unknown>): string {
  return base64url(JSON.stringify({
    clientId: "third-party-client", redirectUri: "https://app.example/cb", state: "c",
    scope: ["x"], iat: 1700000000, exp: 1700000300, ...extra,
  })) + ".fake-mac";
}

const CARRIED_STATE = stateWith({
  offer: { offerName: "o", permissions: [{ streamId: "diary", level: "read" }], allowUserChoice: false },
});

type Route = (url: string) => { status: number; body: unknown } | null;

function mockFetch(route: Route) {
  const fetchMock = vi.fn((url: string) => {
    const r = route(String(url)) ?? { status: 404, body: {} };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const coreRoutes: Route = (url) => {
  if (url.endsWith("/oauth2/authorize/accept")) return { status: 200, body: { redirectTo: "https://app.example/cb?code=1" } };
  if (url.endsWith("/oauth2/authorize/refuse")) return { status: 200, body: { redirectTo: "https://app.example/cb?error=access_denied" } };
  if (url.endsWith("/auth/logout")) return { status: 200, body: {} };
  return null;
};

function logoutCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/auth/logout"));
}


function renderState(state: string) {
  const search = `?state=${encodeURIComponent(state)}&pryvApi=${encodeURIComponent(CORE + "/")}`;
  render(
    <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
      <Oauth2Authorize />
    </MemoryRouter>,
  );
}

async function signIn() {
  fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: "alice" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
  await waitFor(() => expect(document.getElementById("oauthAccept")).not.toBeNull());
}

beforeEach(() => {
  vi.stubEnv("VITE_OAUTH_TRUSTED_API_ORIGINS", "");
  _setDeployedSettingsForTest({ trustedApiOrigins: [CORE] });
  loginMock.api.mockResolvedValue([{ streams: [] }]);
  loginMock.login.mockImplementation(() =>
    Promise.resolve({ token: TOKEN, endpoint: ENDPOINT, api: loginMock.api }),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _setDeployedSettingsForTest(null);
  loginMock.login.mockReset();
  loginMock.api.mockReset();
  nav.navigateTo.mockReset();
});

describe("[OASS] Oauth2Authorize personal session", () => {
  it("[OAS1] signs in with this app's appId, never the client id", async () => {
    mockFetch(coreRoutes);
    renderState(CARRIED_STATE);
    await signIn();
    expect(loginMock.login).toHaveBeenCalledWith("alice", "pw", ACCOUNT_APP_ID);
    expect(loginMock.login.mock.calls[0][2]).not.toBe("third-party-client");
  });

  it("[OAS2] ends its session after Accept, then redirects", async () => {
    const fetchMock = mockFetch(coreRoutes);
    renderState(CARRIED_STATE);
    await signIn();
    fireEvent.click(document.getElementById("oauthAccept")!);
    await waitFor(() => expect(logoutCalls(fetchMock)).toHaveLength(1));
    const [url, init] = logoutCalls(fetchMock)[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT + "auth/logout");
    expect((init.headers as Record<string, string>).Authorization).toBe(TOKEN);
    // Ended after the core answered, not before.
    const order = fetchMock.mock.calls.map(([u]) => String(u));
    expect(order.findIndex((u) => u.endsWith("/accept"))).toBeLessThan(order.findIndex((u) => u.endsWith("/auth/logout")));
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://app.example/cb?code=1"));
  });

  it("[OAS3] ends its session after Reject, then redirects", async () => {
    const fetchMock = mockFetch(coreRoutes);
    renderState(CARRIED_STATE);
    await signIn();
    fireEvent.click(document.getElementById("oauthRefuse")!);
    await waitFor(() => expect(logoutCalls(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
  });

  it("[OAS4] leaves alone a session this app keeps open in this browser", async () => {
    // The core handed back the live session of the same appId.
    localStorage.setItem("pryv.session.apiEndpoint", `https://${TOKEN}@core.other-tld.net/alice/`);
    localStorage.setItem("pryv.session.serviceInfoUrl", CORE + "/reg/service/info");
    const fetchMock = mockFetch(coreRoutes);
    renderState(CARRIED_STATE);
    await signIn();
    fireEvent.click(document.getElementById("oauthAccept")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(logoutCalls(fetchMock)).toHaveLength(0);
  });

  it("[OAS5] a failure to end the session does not hold back the redirect", async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith("/auth/logout") ? { status: 500, body: {} } : coreRoutes(url),
    );
    renderState(CARRIED_STATE);
    await signIn();
    fireEvent.click(document.getElementById("oauthAccept")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(logoutCalls(fetchMock)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[OAS6] Cancel before sign-in has no session to end", async () => {
    const fetchMock = mockFetch(coreRoutes);
    renderState(CARRIED_STATE);
    fireEvent.click(document.getElementById("oauthCancelLogin")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(logoutCalls(fetchMock)).toHaveLength(0);
  });
});

describe("[OALB] Oauth2Authorize row labels", () => {
  it("[OAL1] uses the offer's entry labels, then the account's stream names, then the id", async () => {
    mockFetch((url) => {
      if (url.endsWith("/oauth2/authorize/offer")) {
        return {
          status: 200,
          body: {
            client: { clientName: "Registry app" },
            offer: {
              permissions: [
                { streamId: "body-blood-pressure", level: "read" },
                { streamId: "diary", level: "read" },
                { streamId: "raw-id", level: "read" },
              ],
              entryLabels: { "s|body-blood-pressure|read": { en: "Blood pressure" } },
            },
          },
        };
      }
      return coreRoutes(url);
    });
    loginMock.api.mockResolvedValue([{ streams: [{ id: "diary", name: "My diary", children: [] }] }]);
    renderState(stateWith({ offerRef: { kind: "synthesised", digest: "d" } }));
    await screen.findByText("Registry app");
    await signIn();
    await screen.findByText("Read “Blood pressure”");
    await screen.findByText("Read “My diary”");
    expect(screen.getByText("Read “raw-id”")).toBeTruthy();
    expect(screen.queryByText("Read “body-blood-pressure”")).toBeNull();
  });
});
