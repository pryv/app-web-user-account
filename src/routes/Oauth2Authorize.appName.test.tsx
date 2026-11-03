// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [OANM] Who is asking, before and after sign-in, for a client registered
 * without an app account (offer by reference). The sign-in names the app only
 * once the core answered the signed-out /offer: while it is pending, nobody is
 * named (never the bare client id) and Sign in waits. The operator's catalog
 * wins over the registration; with no name at all, the id is shown marked as
 * an identifier. The logo is shown only over https. The consent screen keeps
 * the id in small print under the name, and the registered description.
 */

const loginMock = vi.hoisted(() => ({ login: vi.fn() }));
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

const catalog = vi.hoisted(() => ({ getAppCatalog: vi.fn() }));
vi.mock("../lib/appCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/appCatalog")>()),
  ...catalog,
}));

import Oauth2Authorize from "./Oauth2Authorize";
import { parseCatalog } from "../lib/appCatalog";
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";

const CORE = "https://core.other-tld.net";
const CLIENT_ID = "reg-app";

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const REF_STATE = base64url(JSON.stringify({
  clientId: CLIENT_ID, redirectUri: "https://app.example/cb", state: "c", scope: ["x"],
  iat: 1700000000, exp: 1700000300, offerRef: { kind: "synthesised", digest: "d" },
})) + ".fake-mac";

const OFFER = { permissions: [{ streamId: "a", level: "read" }] };

type Answer = { status: number; body: unknown };

/** `offer` answers the signed-out /offer (a promise to hold it pending). */
function mockCore(offer: () => Answer | Promise<Answer>) {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    const r: Answer = u.endsWith("/oauth2/authorize/offer") ? await offer() : { status: 404, body: {} };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  const search = `?state=${encodeURIComponent(REF_STATE)}&pryvApi=${encodeURIComponent(CORE + "/")}`;
  render(
    <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
      <Oauth2Authorize />
    </MemoryRouter>,
  );
}

const prompt = () => document.getElementById("oauthAppPrompt") as HTMLElement;
const signInButton = () => screen.getByRole("button", { name: /^sign in$/i }) as HTMLButtonElement;

async function signIn() {
  await waitFor(() => expect(signInButton().disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: "alice" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
  fireEvent.click(signInButton());
  await waitFor(() => expect(document.getElementById("oauthAccept")).not.toBeNull());
}

beforeEach(() => {
  vi.stubEnv("VITE_OAUTH_TRUSTED_API_ORIGINS", "");
  _setDeployedSettingsForTest({ trustedApiOrigins: [CORE] });
  catalog.getAppCatalog.mockResolvedValue(parseCatalog({ schemaVersion: 1, apps: [] }));
  loginMock.login.mockResolvedValue({ token: "tok", endpoint: CORE + "/alice/" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _setDeployedSettingsForTest(null);
  catalog.getAppCatalog.mockReset();
  loginMock.login.mockReset();
});

describe("[OANM] the requesting app's name on the OAuth2 sign-in", () => {
  it("[OANM1] while the signed-out offer is pending, Sign in is disabled and the prompt names nobody", async () => {
    let answer: (a: Answer) => void = () => {};
    mockCore(() => new Promise<Answer>((resolve) => { answer = resolve; }));
    renderPage();
    await waitFor(() => expect(catalog.getAppCatalog).toHaveBeenCalled());
    expect(signInButton().disabled).toBe(true);
    expect(prompt().textContent).toMatch(/being verified/);
    expect(prompt().textContent).not.toContain(CLIENT_ID);
    // Cancel (a refusal, no session needed) stays available.
    expect((document.getElementById("oauthCancelLogin") as HTMLButtonElement).disabled).toBe(false);
    answer({ status: 200, body: { client: { clientId: CLIENT_ID, clientName: "Registry app" }, offer: OFFER } });
    await screen.findByText("Registry app");
    expect(signInButton().disabled).toBe(false);
    expect(prompt().textContent).not.toContain(CLIENT_ID);
  });

  it("[OANM2] names the app by its registered clientName when the catalog has no entry", async () => {
    mockCore(() => ({ status: 200, body: { client: { clientId: CLIENT_ID, clientName: "Registry app" }, offer: OFFER } }));
    renderPage();
    await screen.findByText("Registry app");
    expect(prompt().textContent).toMatch(/^Registry app wants to access your/);
  });

  it("[OANM3] a catalog entry wins over the registered clientName", async () => {
    catalog.getAppCatalog.mockResolvedValue(parseCatalog({
      schemaVersion: 1, apps: [{ id: CLIENT_ID, name: "Curated name" }],
    }));
    mockCore(() => ({ status: 200, body: { client: { clientId: CLIENT_ID, clientName: "Registry app" }, offer: OFFER } }));
    renderPage();
    await screen.findByText("Curated name");
    await waitFor(() => expect(signInButton().disabled).toBe(false));
    expect(screen.queryByText("Registry app")).toBeNull();
  });

  it("[OANM4] with no registered name, the id is shown marked as an identifier, never bare", async () => {
    mockCore(() => ({ status: 200, body: { client: { clientId: CLIENT_ID }, offer: OFFER } }));
    renderPage();
    await waitFor(() => expect(signInButton().disabled).toBe(false));
    expect(prompt().textContent).toMatch(new RegExp(`^An application \\(application id: ${CLIENT_ID}\\) wants to access your `));
    expect(prompt().querySelector("code")?.textContent).toBe(CLIENT_ID);
    await signIn();
    expect(document.getElementById("oauthClientIdText")?.textContent).toBe(`Application id: ${CLIENT_ID}`);
    expect(document.getElementById("oauthClientIdNote")).toBeNull();
  });

  it("[OANM5] a logo is rendered only from an https URL", async () => {
    mockCore(() => ({
      status: 200,
      body: { client: { clientId: CLIENT_ID, clientName: "Registry app", logoUri: "http://logo.example/l.png" }, offer: OFFER },
    }));
    renderPage();
    await screen.findByText("Registry app");
    expect(prompt().querySelector("img")).toBeNull();
    cleanup();
    mockCore(() => ({
      status: 200,
      body: { client: { clientId: CLIENT_ID, clientName: "Registry app", logoUri: "https://logo.example/l.png" }, offer: OFFER },
    }));
    renderPage();
    await screen.findByText("Registry app");
    expect(prompt().querySelector("img")?.getAttribute("src")).toBe("https://logo.example/l.png");
  });

  it("[OANM6] a failed signed-out offer renders the error card, not the sign-in", async () => {
    mockCore(() => ({ status: 400, body: { error: "invalid_request", error_description: "unknown client" } }));
    renderPage();
    await waitFor(() => expect(document.getElementById("oauthInitError")).not.toBeNull());
    expect(screen.getByText("unknown client")).toBeTruthy();
    expect(document.getElementById("oauthAppPrompt")).toBeNull();
  });

  it("[OANM7] a localized registered name is picked for the UI language, clientName is the fallback", async () => {
    mockCore(() => ({
      status: 200,
      body: {
        client: { clientId: CLIENT_ID, clientName: "Plain name", name: { fr: "Nom", en: "Localized name" } },
        offer: OFFER,
      },
    }));
    renderPage();
    await screen.findByText("Localized name");
    expect(screen.queryByText("Plain name")).toBeNull();
    cleanup();
    // A name map with nothing usable falls back to clientName.
    mockCore(() => ({
      status: 200,
      body: { client: { clientId: CLIENT_ID, clientName: "Plain name", name: { en: 3 } }, offer: OFFER },
    }));
    renderPage();
    await screen.findByText("Plain name");
  });

  it("[OANM8] the consent screen shows the id in small print under the name, and the description there only", async () => {
    mockCore(() => ({
      status: 200,
      body: {
        client: { clientId: CLIENT_ID, clientName: "Registry app", description: { en: "Keeps your diary." } },
        offer: OFFER,
      },
    }));
    renderPage();
    await screen.findByText("Registry app");
    expect(screen.queryByText("Keeps your diary.")).toBeNull();
    await signIn();
    expect(document.getElementById("oauthClientIdText")?.textContent).toBe("Registry app");
    expect(document.getElementById("oauthClientIdNote")?.textContent).toBe(`Application id: ${CLIENT_ID}`);
    expect(screen.getByText("Keeps your diary.")).toBeTruthy();
  });

  it("[OANM9] a catalog entry names the app while the offer is pending; Sign in still waits and says why", async () => {
    catalog.getAppCatalog.mockResolvedValue(parseCatalog({
      schemaVersion: 1, apps: [{ id: CLIENT_ID, name: "Curated name" }],
    }));
    let answer: (a: Answer) => void = () => {};
    mockCore(() => new Promise<Answer>((resolve) => { answer = resolve; }));
    renderPage();
    await screen.findByText("Curated name");
    expect(signInButton().disabled).toBe(true);
    expect(document.getElementById("oauthAppVerifying")?.textContent).toMatch(/being verified/);
    answer({ status: 200, body: { client: { clientId: CLIENT_ID, clientName: "Registry app" }, offer: OFFER } });
    await waitFor(() => expect(signInButton().disabled).toBe(false));
    expect(document.getElementById("oauthAppVerifying")).toBeNull();
  });

  it("[OANM10] pressing Enter in the form while the offer is pending does not sign in", async () => {
    mockCore(() => new Promise<Answer>(() => {}));
    renderPage();
    fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
    fireEvent.submit(signInButton().closest("form") as HTMLFormElement);
    await new Promise((r) => setTimeout(r, 20));
    expect(loginMock.login).not.toHaveBeenCalled();
  });

  it("[OANM11] a state-carried offer with no catalog entry shows the id marked, never bare", async () => {
    const fetchMock = mockCore(() => ({ status: 404, body: {} }));
    const state = base64url(JSON.stringify({
      clientId: CLIENT_ID, redirectUri: "https://app.example/cb", state: "c", scope: ["x"],
      iat: 1700000000, exp: 1700000300, offer: { offerName: "o", ...OFFER },
    })) + ".fake-mac";
    render(
      <MemoryRouter initialEntries={[`/oauth2-authorize?state=${encodeURIComponent(state)}&pryvApi=${encodeURIComponent(CORE + "/")}`]}>
        <Oauth2Authorize />
      </MemoryRouter>,
    );
    await waitFor(() => expect(catalog.getAppCatalog).toHaveBeenCalled());
    expect(signInButton().disabled).toBe(false);
    expect(prompt().textContent).toMatch(/^An application \(application id: reg-app\) wants to access your /);
    await signIn();
    expect(document.getElementById("oauthClientIdText")?.textContent).toBe(`Application id: ${CLIENT_ID}`);
    expect(document.querySelector("#oauthClientIdText code")?.textContent).toBe(CLIENT_ID);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/oauth2/authorize/offer"))).toBe(false);
  });

  it("[OANM12] the client's https links are on the consent screen only, as fixed link texts", async () => {
    mockCore(() => ({
      status: 200,
      body: {
        client: {
          clientId: CLIENT_ID,
          clientName: "Registry app",
          clientUri: "https://app.example/",
          policyUri: "http://app.example/privacy",
          tosUri: "https://app.example/terms",
        },
        offer: OFFER,
      },
    }));
    renderPage();
    await screen.findByText("Registry app");
    expect(document.getElementById("oauthClientLinks")).toBeNull();
    await signIn();
    const website = screen.getByRole("link", { name: "Website" });
    expect(website.getAttribute("href")).toBe("https://app.example/");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Terms of use" }).getAttribute("href")).toBe("https://app.example/terms");
    // Not over https: not linked.
    expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull();
  });

  it("[OANM13] a blank registered name counts as none: the id is shown marked", async () => {
    mockCore(() => ({ status: 200, body: { client: { clientId: CLIENT_ID, clientName: "   ", name: { en: " " } }, offer: OFFER } }));
    renderPage();
    await waitFor(() => expect(signInButton().disabled).toBe(false));
    expect(prompt().querySelector("code")?.textContent).toBe(CLIENT_ID);
  });
});
