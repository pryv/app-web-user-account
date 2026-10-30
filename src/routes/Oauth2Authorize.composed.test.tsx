// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [OACS] A consent shown again to an app the user already allowed. Once
 * signed in, the page reads the offer again with its session: the core joins
 * what the app holds with what it asks for, flags the held entries, and
 * answers a digest of that screen, which Accept posts back. A change of
 * identity mode must be acknowledged before Accept is enabled. A screen the
 * core no longer recognises asks the user to restart from the app. An older
 * core (no digest) keeps today's behaviour.
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

const CORE = "https://core.other-tld.net";
const ENDPOINT = CORE + "/alice/";
const TOKEN = "consent-tok";

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const REF_STATE = base64url(JSON.stringify({
  clientId: "registry-client", redirectUri: "https://app.example/cb", state: "c",
  scope: ["x"], iat: 1700000000, exp: 1700000300,
  offerRef: { kind: "synthesised", digest: "d" },
})) + ".fake-mac";

/** What the app asks for (the answer without a session). */
const REQUESTED = {
  allowUserChoice: true,
  randomAlias: false,
  permissions: [
    { streamId: "pressure", level: "read", mandatory: true },
    { streamId: "steps", level: "read", optIn: true },
    { feature: "webhooks", setting: "forbidden", mandatory: true },
  ],
  entryLabels: {
    "s|pressure|read": { en: "Blood pressure" },
    "s|steps|read": { en: "Steps" },
  },
};

/** The same, joined with what the app holds (`diary`, only in the grant). */
const COMPOSED = {
  ...REQUESTED,
  permissions: [
    { streamId: "pressure", level: "read", mandatory: true, currentlyGranted: true },
    { streamId: "diary", level: "contribute", currentlyGranted: true },
    { streamId: "steps", level: "read", optIn: true },
    // A restriction the grant already carries: no "already allowed" hint.
    { feature: "webhooks", setting: "forbidden", mandatory: true, currentlyGranted: true },
  ],
};

type Answer = { status: number; body: unknown };
type Route = (url: string, body: Record<string, unknown>) => Answer | null;

function mockFetch(route: Route) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const r = route(String(url), body) ?? { status: 404, body: {} };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CLIENT = { clientId: "registry-client", clientName: "Registry app" };

/** A core that composes: with a session, the joined offer plus a digest. */
function composingCore(extra: Record<string, unknown> = {}, accept?: (body: Record<string, unknown>) => Answer): Route {
  return (url, body) => {
    if (url.endsWith("/oauth2/authorize/offer")) {
      if (body.userToken == null) return { status: 200, body: { client: CLIENT, offer: REQUESTED } };
      return {
        status: 200,
        body: {
          client: CLIENT,
          offer: COMPOSED,
          shownDigest: "digest-1",
          currentGrant: { subjectMode: "account" },
          subjectChange: null,
          ...extra,
        },
      };
    }
    if (url.endsWith("/oauth2/authorize/accept")) {
      return accept ? accept(body) : { status: 200, body: { redirectTo: "https://app.example/cb?code=1" } };
    }
    if (url.endsWith("/oauth2/authorize/refuse")) return { status: 200, body: { redirectTo: "https://app.example/cb?error=access_denied" } };
    if (url.endsWith("/auth/logout")) return { status: 200, body: {} };
    return null;
  };
}

function bodiesOf(fetchMock: ReturnType<typeof mockFetch>, suffix: string): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith(suffix))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

function renderPage() {
  const search = `?state=${encodeURIComponent(REF_STATE)}&pryvApi=${encodeURIComponent(CORE + "/")}`;
  render(
    <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
      <Oauth2Authorize />
    </MemoryRouter>,
  );
}

async function signIn() {
  await screen.findByText("Registry app");
  fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: "alice" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

async function signInToConsent() {
  await signIn();
  await waitFor(() => expect(document.getElementById("oauthAccept")).not.toBeNull());
}

const box = (i: number) => document.getElementById("oauthScope-" + i) as HTMLInputElement;
const acceptButton = () => document.getElementById("oauthAccept") as HTMLButtonElement;

beforeEach(() => {
  vi.stubEnv("VITE_OAUTH_TRUSTED_API_ORIGINS", "");
  _setDeployedSettingsForTest({ trustedApiOrigins: [CORE] });
  loginMock.api.mockResolvedValue([{ streams: [{ id: "diary", name: "My diary", children: [] }] }]);
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

describe("[OACS] Oauth2Authorize composed consent", () => {
  it("[OACS1] reads the offer again with the session and shows held entries ticked, new optIn ones unticked", async () => {
    const fetchMock = mockFetch(composingCore());
    renderPage();
    await signInToConsent();
    const offers = bodiesOf(fetchMock, "/oauth2/authorize/offer");
    expect(offers).toHaveLength(2);
    expect(offers[0]).toEqual({ state: REF_STATE });
    expect(offers[1]).toEqual({ state: REF_STATE, username: "alice", userToken: TOKEN });
    // Held + mandatory: ticked and locked.
    expect(box(0).checked).toBe(true);
    expect(box(0).disabled).toBe(true);
    // Held only: ticked, the user may take it away; named from the account.
    expect(box(1).checked).toBe(true);
    expect(box(1).disabled).toBe(false);
    await screen.findByText("Add and modify “My diary”");
    // New and optIn: unticked.
    expect(box(2).checked).toBe(false);
    expect(box(2).disabled).toBe(false);
    expect(screen.getByText("Read “Steps”")).toBeTruthy();
    // A restriction: a locked "cannot" line.
    expect(box(3).checked).toBe(true);
    expect(box(3).disabled).toBe(true);
    expect(screen.getByText(/The app cannot register webhooks/)).toBeTruthy();
    expect(screen.getAllByText("(already allowed)")).toHaveLength(2);
    expect(document.getElementById("oauthReconsentNotice")?.textContent).toMatch(/Untick an entry to take it away/);
    expect(document.getElementById("oauthSubjectChange")).toBeNull();
  });

  it("[OACS2] posts the digest of the screen shown with the ticked set (a held entry unticked is left out)", async () => {
    const fetchMock = mockFetch(composingCore());
    renderPage();
    await signInToConsent();
    fireEvent.click(box(1));
    fireEvent.click(acceptButton());
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://app.example/cb?code=1"));
    const [accept] = bodiesOf(fetchMock, "/oauth2/authorize/accept");
    expect(accept.shownDigest).toBe("digest-1");
    expect("acknowledgeSubjectChange" in accept).toBe(false);
    expect(accept.grantedPermissions).toEqual([
      { streamId: "pressure", level: "read" },
      { feature: "webhooks", setting: "forbidden" },
    ]);
  });

  it("[OACS9] unticking every stream (restrictions alone) is stopped before the core", async () => {
    const fetchMock = mockFetch(composingCore({
      offer: {
        ...COMPOSED,
        permissions: [
          { streamId: "diary", level: "contribute", currentlyGranted: true },
          { feature: "webhooks", setting: "forbidden", mandatory: true },
        ],
      },
    }));
    renderPage();
    await signInToConsent();
    fireEvent.click(box(0));
    fireEvent.click(acceptButton());
    await screen.findByText(/Keep at least one permission ticked/);
    expect(bodiesOf(fetchMock, "/oauth2/authorize/accept")).toHaveLength(0);
  });

  it("[OACS3] a change of identity mode must be acknowledged before Accept", async () => {
    const fetchMock = mockFetch(composingCore({
      offer: { ...COMPOSED, randomAlias: false },
      currentGrant: { subjectMode: "pseudonym" },
      subjectChange: { from: "pseudonym", to: "account" },
    }));
    renderPage();
    await signInToConsent();
    const warning = document.getElementById("oauthSubjectChange");
    expect(warning?.textContent).toMatch(/known you by a pseudonym/);
    expect(warning?.textContent).toMatch(/link it to what it already holds/);
    expect(acceptButton().disabled).toBe(true);
    const ack = document.getElementById("oauthAcknowledgeSubjectChange") as HTMLInputElement;
    expect(ack.checked).toBe(false);
    fireEvent.click(ack);
    expect(acceptButton().disabled).toBe(false);
    fireEvent.click(ack);
    expect(acceptButton().disabled).toBe(true);
    fireEvent.click(ack);
    fireEvent.click(acceptButton());
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    const [accept] = bodiesOf(fetchMock, "/oauth2/authorize/accept");
    expect(accept.shownDigest).toBe("digest-1");
    expect(accept.acknowledgeSubjectChange).toBe(true);
  });

  it("[OACS4] the other direction has its own copy, and a pseudonym offer says what an alias does not hide", async () => {
    mockFetch(composingCore({
      offer: { ...COMPOSED, randomAlias: true },
      subjectChange: { from: "account", to: "pseudonym" },
    }));
    renderPage();
    await signInToConsent();
    expect(document.getElementById("oauthSubjectChange")?.textContent).toMatch(/already knows your account/);
    expect(document.getElementById("oauthIdentityNotice")?.textContent).toMatch(/pseudonym/);
    expect(document.getElementById("oauthLinkabilityNotice")?.textContent).toMatch(/can still be enough to tell who you are/);
  });

  it("[OACS5] a screen the core no longer recognises (reason marker) asks to restart from the app", async () => {
    mockFetch(composingCore({}, () => ({
      status: 400,
      body: { error: "invalid_request", error_description: "screen mismatch", reason: "consent-out-of-date" },
    })));
    renderPage();
    await signInToConsent();
    fireEvent.click(acceptButton());
    await screen.findByText(/This consent screen is out of date/);
    expect(screen.getByText(/start the authorization again/)).toBeTruthy();
    expect(screen.queryByText("screen mismatch")).toBeNull();
    expect(acceptButton().disabled).toBe(true);
    expect(nav.navigateTo).not.toHaveBeenCalled();
    // Reject still hands the user back to the app.
    fireEvent.click(document.getElementById("oauthRefuse")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://app.example/cb?error=access_denied"));
  });

  it("[OACS12] a held stream asked at a wider level says what the app holds and what it asks for", async () => {
    const fetchMock = mockFetch(composingCore({
      offer: {
        ...COMPOSED,
        permissions: [
          { streamId: "pressure", level: "read", mandatory: true, currentlyGranted: true, currentLevel: "read" },
          { streamId: "diary", level: "contribute", currentlyGranted: true, currentLevel: "read" },
        ],
      },
    }));
    renderPage();
    await signInToConsent();
    expect(screen.getAllByText("(already allowed)")).toHaveLength(1);
    expect(screen.getByText("(the app can already: Read; it now asks for: Add and modify)")).toBeTruthy();
    fireEvent.click(acceptButton());
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    const [accept] = bodiesOf(fetchMock, "/oauth2/authorize/accept");
    // The annotation never travels.
    expect(accept.grantedPermissions).toEqual([
      { streamId: "pressure", level: "read" },
      { streamId: "diary", level: "contribute" },
    ]);
  });

  it("[OACS13] the hierarchy refusal reads as what to change on the screen", async () => {
    mockFetch(composingCore({}, () => ({
      status: 400,
      body: { error: "invalid_scope", error_description: "grantedPermissions widen the offer under the stream hierarchy", reason: "consent-widens-offer" },
    })));
    renderPage();
    await signInToConsent();
    fireEvent.click(acceptButton());
    await screen.findByText(/Untick the containing entry too, or keep this one ticked/);
    expect(screen.queryByText(/widen the offer/)).toBeNull();
    expect(acceptButton().disabled).toBe(false);
  });

  it("[OACS14] level-conflict and keep-one-stream refusals show the core's message", async () => {
    let answer = { error: "invalid_scope", error_description: "conflicting permission level on a requested resource: diary", reason: "permission-level-conflict" };
    mockFetch(composingCore({}, () => ({ status: 400, body: answer })));
    renderPage();
    await signInToConsent();
    fireEvent.click(acceptButton());
    await screen.findByText(answer.error_description);
    answer = { error: "invalid_scope", error_description: "grantedPermissions must keep at least one stream permission (refuse instead)", reason: "keep-one-stream" };
    fireEvent.click(acceptButton());
    await screen.findByText(answer.error_description);
  });

  it("[OACS10] a core without the reason marker is recognised by its wording", async () => {
    mockFetch(composingCore({}, () => ({
      status: 400,
      body: { error: "invalid_request", error_description: "the consent screen is out of date, restart the authorization flow" },
    })));
    renderPage();
    await signInToConsent();
    fireEvent.click(acceptButton());
    await screen.findByText(/This consent screen is out of date/);
    expect(acceptButton().disabled).toBe(true);
  });

  it("[OACS11] an unacknowledged-change refusal is shown as such, Accept stays available", async () => {
    mockFetch(composingCore({}, () => ({
      status: 400,
      body: { error: "invalid_request", error_description: "the change of identity mode must be acknowledged", reason: "subject-change-unacknowledged" },
    })));
    renderPage();
    await signInToConsent();
    fireEvent.click(acceptButton());
    await screen.findByText("the change of identity mode must be acknowledged");
    expect(screen.queryByText(/This consent screen is out of date/)).toBeNull();
    expect(acceptButton().disabled).toBe(false);
  });

  it("[OACS6] an older core (no digest) keeps the offer read before sign-in and posts no digest", async () => {
    const fetchMock = mockFetch((url, body) => {
      if (url.endsWith("/oauth2/authorize/offer")) return { status: 200, body: { client: CLIENT, offer: REQUESTED } };
      return composingCore()(url, body);
    });
    renderPage();
    await signInToConsent();
    expect(bodiesOf(fetchMock, "/oauth2/authorize/offer")).toHaveLength(2);
    expect(screen.queryByText("(already allowed)")).toBeNull();
    expect(document.getElementById("oauthReconsentNotice")).toBeNull();
    expect(screen.queryByText(/My diary/)).toBeNull();
    fireEvent.click(acceptButton());
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    const [accept] = bodiesOf(fetchMock, "/oauth2/authorize/accept");
    expect("shownDigest" in accept).toBe(false);
    expect("acknowledgeSubjectChange" in accept).toBe(false);
    expect(accept.grantedPermissions).toEqual([
      { streamId: "pressure", level: "read" },
      { feature: "webhooks", setting: "forbidden" },
    ]);
  });

  it("[OACS7] a session the core does not accept goes back to the sign-in", async () => {
    mockFetch((url, body) => {
      if (url.endsWith("/oauth2/authorize/offer") && body.userToken != null) {
        return { status: 200, body: { client: CLIENT, offer: REQUESTED, authenticated: false } };
      }
      return composingCore()(url, body);
    });
    renderPage();
    await signIn();
    await screen.findByText(/sign-in for this authorization has ended/);
    expect(document.getElementById("oauthAccept")).toBeNull();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });

  it("[OACS8] when the offer cannot be read with the session, the only way on is back to the app", async () => {
    mockFetch((url, body) => {
      if (url.endsWith("/oauth2/authorize/offer") && body.userToken != null) {
        return { status: 400, body: { error: "invalid_scope", error_description: "the request conflicts with the access the app holds" } };
      }
      return composingCore()(url, body);
    });
    renderPage();
    await signIn();
    await screen.findByText(/conflicts with the access the app holds/);
    expect(document.getElementById("oauthAccept")).toBeNull();
    fireEvent.click(document.getElementById("oauthRefuse")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://app.example/cb?error=access_denied"));
  });
});
