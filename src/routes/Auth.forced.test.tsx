// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * [AXF] `/auth` with an external id in FORCED mode: only the account linked to
 * the id may accept. The page reads the account's own list of ids (namespaces
 * only, no value): an account holding none in the namespace is a known
 * non-holder and gets the sign-in form first, with nothing granted. One
 * holding an id there goes on, and the register decides at ACCEPTED:
 * `external-id-mismatch` removes the access just minted and brings the form
 * back, the stored session kept; `external-id-check-unavailable` is retried
 * once. No link dialog, no `externalIdDeclined`, no shape H hand-off. The
 * blinded value is never rendered, stored, or put in a URL.
 */

const flow = vi.hoisted(() => ({
  loadAccessState: vi.fn(),
  updateAccessState: vi.fn(),
  checkAppAccess: vi.fn(),
  createAppAccess: vi.fn(),
  deleteAppAccess: vi.fn(),
  createHandoffSecret: vi.fn(),
  closeOrRedirect: vi.fn(),
  deriveServiceInfoUrlFromPollUrl: vi.fn(() => "https://core.test/service/info"),
}));
vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
}));

// The sign-in form, reduced to what the page hands it: its notice, its error,
// its footer, and a sign-in as bob.
vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({
    onSignedIn,
    notice,
    externalError,
    footer,
  }: {
    onSignedIn: (s: unknown) => void;
    notice?: ReactNode;
    externalError?: string | null;
    footer?: (busy: boolean) => ReactNode;
  }) => (
    <div data-testid="signin-form">
      {notice}
      {externalError && <p data-testid="signin-error">{externalError}</p>}
      <button
        type="button"
        onClick={() =>
          void onSignedIn({
            username: "bob",
            personalToken: "bob-token",
            endpoint: "https://bob.core.test/",
            connection: {
              apiEndpoint: "https://bob-token@bob.core.test/",
              endpoint: "https://bob.core.test/",
              token: "bob-token",
              username: async () => "bob",
              service: { info: async () => ({}) },
            },
          })
        }
      >
        sign-in-as-bob
      </button>
      {footer?.(false)}
    </div>
  ),
}));

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      token: string;
      service = { info: async () => ({}) };
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        const url = new URL(apiEndpoint);
        this.token = url.username;
        url.username = "";
        this.endpoint = url.toString();
      }
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const REGISTER = "https://reg.core.test/";
const BLINDED = "blinded-7f3a9c-secret-value";
const FORCED = { namespace: "clinic-a", label: "Clinic A", blindedValue: BLINDED, mode: "forced" };
const HINT = { ...FORCED, mode: "hint" };
const SWITCH = "This invitation is for the account linked to Clinic A. Sign in with that account.";

interface Answer {
  status: number;
  body?: unknown;
}
const HOLDS: Answer = { status: 200, body: { externalIds: [{ namespace: "clinic-a", claimedAt: 1 }] } };
const NONE: Answer = { status: 200, body: { externalIds: [{ namespace: "other", claimedAt: 1 }] } };
/** Each account's own list of ids, by username. */
let lists: Record<string, Answer> = {};
let lookupAnswer: Answer = { status: 404 };
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const reply = (a: Answer | undefined) => {
    const answer = a ?? { status: 500 };
    return { status: answer.status, ok: answer.status < 300, json: async () => answer.body ?? {} } as Response;
  };
  if (url === REGISTER + "ext-id/cores" && init?.method === "POST") return reply(lookupAnswer);
  const list = /^https:\/\/([a-z]+)\.core\.test\/account\/external-ids$/.exec(url);
  if (list && init?.method === "GET") return reply(lists[list[1]]);
  return reply({ status: 404 });
});

const calls = (suffix: string, method: string) =>
  fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith(suffix) && init?.method === method);

function storeAlice() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://alice-session@alice.core.test/");
}

function openAuth(externalId: unknown = FORCED, extra: Record<string, unknown> = {}) {
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId: "clinic-app",
    requestedPermissions: PERMS,
    serviceInfo: { api: "https://{username}.core.test/", register: REGISTER },
    externalId,
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function acceptAsAlice() {
  (await screen.findByRole("button", { name: "Continue as alice" })).click();
  (await screen.findByRole("button", { name: "Accept" })).click();
}

function expectNoBlindedValueAnywhere() {
  expect(document.body.innerHTML).not.toContain(BLINDED);
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)!;
      expect(k + "=" + store.getItem(k)).not.toContain(BLINDED);
    }
  }
  expect(window.location.href).not.toContain(BLINDED);
  for (const [u, init] of fetchMock.mock.calls) {
    expect(String(u)).not.toContain(BLINDED);
    // The list read sends no value at all.
    if (init?.method === "GET") expect(init.body).toBeUndefined();
  }
}

function expectNothingGranted() {
  expect(flow.checkAppAccess).not.toHaveBeenCalled();
  expect(flow.createAppAccess).not.toHaveBeenCalled();
  expect(flow.updateAccessState).not.toHaveBeenCalled();
}

describe("[AXF] /auth with an external id (forced mode)", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-1", token: "app-token", permissions: PERMS });
    flow.deleteAppAccess.mockResolvedValue(undefined);
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    lists = { alice: HOLDS, bob: NONE };
    lookupAnswer = { status: 404 };
    localStorage.clear();
    sessionStorage.clear();
    storeAlice();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("[AXF1] stored session holding no id in the namespace: the form first with the switch notice, no Continue as, nothing granted", async () => {
    lists.alice = NONE;
    openAuth();
    const form = await screen.findByTestId("signin-form");
    expect(screen.getByTestId("external-id-switch").textContent).toBe(SWITCH);
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(form.textContent).not.toContain("Continue as alice instead");
    // The list was read with the session's own token; no lookup in forced mode.
    const [[listUrl, listInit]] = calls("account/external-ids", "GET");
    expect(listUrl).toBe("https://alice.core.test/account/external-ids");
    expect((listInit!.headers as Record<string, string>).Authorization).toBe("alice-session");
    expect(calls("ext-id/cores", "POST")).toHaveLength(0);
    expectNothingGranted();
    // The stored session is left as it is, for other requests.
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe("https://alice-session@alice.core.test/");
    expectNoBlindedValueAnywhere();
  });

  it("[AXF1b] a fresh sign-in holding no id: back to the form with why, before anything is checked or minted", async () => {
    localStorage.clear();
    openAuth();
    expect((await screen.findByTestId("external-id-switch")).textContent).toBe(SWITCH);
    screen.getByRole("button", { name: "sign-in-as-bob" }).click();
    expect((await screen.findByTestId("signin-error")).textContent).toBe(
      "The account bob is not the one linked to Clinic A. Nothing was granted.",
    );
    expect(screen.getByTestId("external-id-switch").textContent).toBe(SWITCH);
    expect(screen.getByTestId("signin-form").textContent).not.toContain("Continue as bob instead");
    expect(calls("account/external-ids", "GET").map(([u]) => String(u))).toEqual([
      "https://bob.core.test/account/external-ids",
    ]);
    expectNothingGranted();
    expectNoBlindedValueAnywhere();
  });

  it("[AXF1c] (hint mode) a stored session holding no id while an account holds it: the form first, Continue as stays", async () => {
    lists.alice = NONE;
    lookupAnswer = { status: 200, body: { server: "https://core-b.test/" } };
    openAuth(HINT);
    const form = await screen.findByTestId("signin-form");
    expect(screen.getByTestId("external-id-claimed").textContent).toContain("Clinic A");
    (await screen.findByRole("button", { name: "Continue as alice instead" })).click();
    (await screen.findByRole("button", { name: "Accept" })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(form.isConnected).toBe(false);
  });

  it("[AXF2] stored session holding an id: the Welcome back card with the switch hint, and the accept goes to the register", async () => {
    openAuth();
    expect((await screen.findByTestId("external-id-other-account")).textContent).toBe(
      "If alice is not the account linked to Clinic A, sign in with the other account.",
    );
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expectNoBlindedValueAnywhere();
    await acceptAsAlice();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const [pollUrl, body] = flow.updateAccessState.mock.calls[0];
    expect(pollUrl).toBe(POLL);
    expect(body.status).toBe("ACCEPTED");
    expect(body.token).toBe("app-token");
    expect(flow.closeOrRedirect).toHaveBeenCalled();
    expectNoBlindedValueAnywhere();
  });

  it("[AXF2b] (hint mode, N4) an account holds the id and the session holds one in the namespace: the switch hint, not 'sign in with that account'", async () => {
    lookupAnswer = { status: 200, body: { server: "https://core-b.test/" } };
    openAuth(HINT);
    expect((await screen.findByTestId("external-id-other-account")).textContent).toBe(
      "If alice is not the account linked to Clinic A, sign in with the other account.",
    );
    expect(screen.queryByTestId("external-id-claimed")).toBeNull();
  });

  // Mutation-verified: with the mismatch handling removed from accept() (the
  // refusal then shown as a generic one on the consent panel), this fails.
  it("[AXF3] external-id-mismatch: the access just minted is deleted, the form comes back with why, the stored session kept", async () => {
    flow.updateAccessState.mockResolvedValue({ status: 400, errorId: "external-id-mismatch", reason: "not-holder" });
    openAuth();
    await acceptAsAlice();
    expect((await screen.findByTestId("signin-error")).textContent).toBe(
      "The account alice is not the one linked to Clinic A. Nothing was granted.",
    );
    expect(flow.deleteAppAccess).toHaveBeenCalledWith("https://alice.core.test/", "alice-session", "acc-1");
    expect(screen.getByTestId("external-id-switch").textContent).toBe(SWITCH);
    expect(screen.queryByText("Welcome back")).toBeNull();
    // The register would refuse alice again: not offered.
    expect(screen.getByTestId("signin-form").textContent).not.toContain("Continue as alice instead");
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe("https://alice-session@alice.core.test/");
    expect(flow.updateAccessState).toHaveBeenCalledTimes(1);
    expect(flow.closeOrRedirect).not.toHaveBeenCalled();
    expectNoBlindedValueAnywhere();
  });

  it("[AXF3b] token-invalid on an access the app already holds: not deleted, the form with the generic refusal", async () => {
    flow.checkAppAccess.mockResolvedValue({ matchingAccess: { id: "old", token: "old-token", permissions: PERMS } });
    flow.updateAccessState.mockResolvedValue({ status: 400, errorId: "external-id-mismatch", reason: "token-invalid" });
    openAuth();
    (await screen.findByRole("button", { name: "Continue as alice" })).click();
    expect((await screen.findByTestId("signin-error")).textContent).toBe(
      "The access that was created does not match what this app requested. Please try again.",
    );
    expect(flow.deleteAppAccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("external-id-switch").textContent).toBe(SWITCH);
  });

  it("[AXF4] external-id-check-unavailable: retried once, then the unverified message; the access minted is deleted", async () => {
    flow.updateAccessState.mockResolvedValue({
      status: 503,
      errorId: "external-id-check-unavailable",
      reason: "core-unreachable",
    });
    openAuth();
    await acceptAsAlice();
    expect(
      await screen.findByText(
        "This access could not be verified right now. Nothing was granted, please try again in a moment.",
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    expect(flow.updateAccessState).toHaveBeenCalledTimes(2);
    expect(flow.deleteAppAccess).toHaveBeenCalledWith("https://alice.core.test/", "alice-session", "acc-1");
    // Still on the consent step: the check says nothing about the account.
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("[AXF4b] external-id-check-unavailable then accepted on the retry: handed over", async () => {
    flow.updateAccessState
      .mockResolvedValueOnce({ status: 503, errorId: "external-id-check-unavailable", reason: "storage-error" })
      .mockResolvedValue({ status: 200 });
    openAuth();
    await acceptAsAlice();
    await waitFor(() => expect(flow.closeOrRedirect).toHaveBeenCalled(), { timeout: 3000 });
    expect(flow.updateAccessState).toHaveBeenCalledTimes(2);
    expect(flow.deleteAppAccess).not.toHaveBeenCalled();
  });

  it("[AXF5] no link dialog on a forced request, no claim, no externalIdDeclined", async () => {
    openAuth();
    await acceptAsAlice();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const body = flow.updateAccessState.mock.calls[0][1];
    expect(body.externalIdDeclined).toBeUndefined();
    expect(screen.queryByTestId("external-id-dialog")).toBeNull();
    expect(calls("account/external-ids", "POST")).toHaveLength(0);
    expect(calls("ext-id/cores", "POST")).toHaveLength(0);
  });

  // Mutation-verified: with `!forced` removed from `canShapeH`, this fails.
  it("[AXF6] forced + shared-secret hand-off: delivered inline (no shape H), the register converts after its check", async () => {
    flow.createHandoffSecret.mockResolvedValue("evt.the-key");
    openAuth(FORCED, { credentialHandoff: "shared-secret" });
    await acceptAsAlice();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const body = flow.updateAccessState.mock.calls[0][1];
    expect(flow.createHandoffSecret).not.toHaveBeenCalled();
    expect(body.handoff).toBeUndefined();
    expect(body.token).toBe("app-token");
    expectNoBlindedValueAnywhere();
  });
});
