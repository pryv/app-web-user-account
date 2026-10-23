// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [AXI] `/auth` with an external id in the access request (hint mode). The id
 * is looked up once the request is loaded. Held by an account: the sign-in
 * step says so, nothing is asked. Held by none: before the ACCEPTED post a
 * built-in dialog asks whether to link it to the account signed in; "Link"
 * claims it, "Not now" posts `externalIdDeclined: true`. The blinded value is
 * never rendered, never in a URL, never in browser storage.
 */

const flow = vi.hoisted(() => ({
  loadAccessState: vi.fn(),
  updateAccessState: vi.fn(),
  checkAppAccess: vi.fn(),
  createAppAccess: vi.fn(),
  deleteAppAccess: vi.fn(),
  closeOrRedirect: vi.fn(),
  deriveServiceInfoUrlFromPollUrl: vi.fn(() => "https://core.test/service/info"),
}));
vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
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
const EXT_ID = { namespace: "clinic-a", label: "Clinic A", blindedValue: BLINDED, mode: "hint" };

interface Answer {
  status: number;
  body?: unknown;
}
/** What the platform answers: the lookup, then each claim in turn. */
let lookupAnswer: Answer | "network-error" = { status: 404 };
let claimAnswers: Array<Answer | "network-error"> = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const reply = (a: Answer | "network-error" | undefined) => {
    if (a === "network-error") throw new TypeError("network down");
    const answer = a ?? { status: 500 };
    return { status: answer.status, ok: answer.status < 300, json: async () => answer.body ?? {} } as Response;
  };
  if (url === REGISTER + "ext-id/cores" && init?.method === "POST") return reply(lookupAnswer);
  if (url === "https://alice.core.test/account/external-ids" && init?.method === "POST") return reply(claimAnswers.shift());
  return reply({ status: 404 });
});

function lookupCalls() {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("ext-id/cores"));
}
function claimCalls() {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith("account/external-ids"));
}

function storeAlice() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://alice-session@alice.core.test/");
}

function openAuth(externalId: unknown = EXT_ID) {
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId: "clinic-app",
    requestedPermissions: PERMS,
    serviceInfo: { api: "https://{username}.core.test/", register: REGISTER },
    ...(externalId != null ? { externalId } : {}),
  });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

/** Stored session: continue as alice, then Accept on the consent panel. */
async function acceptAsAlice() {
  (await screen.findByRole("button", { name: "Continue as alice" })).click();
  (await screen.findByRole("button", { name: "Accept" })).click();
}

/** The body posted with ACCEPTED. */
async function acceptedPost(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
  const [pollUrl, body] = flow.updateAccessState.mock.calls[0];
  expect(pollUrl).toBe(POLL);
  expect(body.status).toBe("ACCEPTED");
  return body;
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
  for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(BLINDED);
}

describe("[AXI] /auth with an external id (hint mode)", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-1", token: "app-token", permissions: PERMS });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    lookupAnswer = { status: 404 };
    claimAnswers = [];
    localStorage.clear();
    sessionStorage.clear();
    storeAlice();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("[AXI1] unclaimed + Link: the id is claimed for the account, then ACCEPTED is posted without externalIdDeclined", async () => {
    claimAnswers = [{ status: 201 }];
    openAuth();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    expect(within(dialog).getByText("Link this record to your account?")).toBeTruthy();
    expect(dialog.textContent).toContain("Clinic A");
    expect(dialog.textContent).toContain("alice");
    expect(dialog.textContent).toContain("the service that invited you will be able to find this account");
    // Nothing is posted while the question is open.
    expect(flow.updateAccessState).not.toHaveBeenCalled();
    within(dialog).getByRole("button", { name: "Link" }).click();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
    const claims = claimCalls();
    expect(claims).toHaveLength(1);
    const [, init] = claims[0];
    expect((init!.headers as Record<string, string>).Authorization).toBe("alice-session");
    expect(JSON.parse(init!.body as string)).toEqual({ namespace: "clinic-a", blindedValue: BLINDED });
    // The lookup went to the platform's register, the value in the body only.
    expect(lookupCalls()).toHaveLength(1);
    expect(JSON.parse(lookupCalls()[0][1]!.body as string)).toEqual({ namespace: "clinic-a", blindedValue: BLINDED });
    expect(screen.queryByTestId("external-id-dialog")).toBeNull();
  });

  it("[AXI2] unclaimed + Not now: no claim, ACCEPTED carries externalIdDeclined: true", async () => {
    openAuth();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    within(dialog).getByRole("button", { name: "Not now" }).click();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBe(true);
    expect(claimCalls()).toHaveLength(0);
  });

  it("[AXI3] claimed: the sign-in steps say an account holds it; no dialog, no claim, no flag", async () => {
    lookupAnswer = { status: 200, body: { server: "https://core-b.test/" } };
    openAuth();
    const notice = await screen.findByTestId("external-id-claimed");
    expect(notice.textContent).toBe(
      "Clinic A: a Pryv account is already linked to this record. Sign in with that account.",
    );
    await acceptAsAlice();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
    expect(screen.queryByTestId("external-id-dialog")).toBeNull();
    expect(claimCalls()).toHaveLength(0);
    // Never a username for the account that holds it.
    expect(document.body.innerHTML).not.toContain("core-b");
  });

  it("[AXI3b] claimed: the notice is on the sign-in form too (no stored session)", async () => {
    localStorage.clear();
    lookupAnswer = { status: 200, body: { server: "https://core-b.test/" } };
    openAuth();
    await screen.findByLabelText("Username or email");
    expect((await screen.findByTestId("external-id-claimed")).textContent).toContain("Clinic A");
  });

  it("[AXI4] claim refused (value-taken): said, then the accept continues without linking and without the flag", async () => {
    claimAnswers = [{ status: 409, body: { error: { id: "external-id-already-claimed", data: { reason: "value-taken" } } } }];
    openAuth();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    within(dialog).getByRole("button", { name: "Link" }).click();
    await within(dialog).findByText("This record is already linked to another account.");
    expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(flow.updateAccessState).not.toHaveBeenCalled();
    within(dialog).getByRole("button", { name: "Continue" }).click();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
  });

  it("[AXI4b] claim refused (namespace-taken): names the namespace, accept continues without the flag", async () => {
    claimAnswers = [{ status: 409, body: { error: { id: "external-id-already-claimed", data: { reason: "namespace-taken" } } } }];
    openAuth();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    within(dialog).getByRole("button", { name: "Link" }).click();
    await within(dialog).findByText("This account is already linked to another record of Clinic A.");
    within(dialog).getByRole("button", { name: "Continue" }).click();
    expect((await acceptedPost()).externalIdDeclined).toBeUndefined();
  });

  it("[AXI4c] too many attempts, then a network error: retry is offered; a later success links", async () => {
    claimAnswers = [{ status: 429 }, "network-error", { status: 200 }];
    openAuth();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    within(dialog).getByRole("button", { name: "Link" }).click();
    await within(dialog).findByText(/Too many attempts/);
    within(dialog).getByRole("button", { name: "Try again" }).click();
    await within(dialog).findByText(/could not be linked/);
    expect(within(dialog).getByRole("button", { name: "Continue without linking" })).toBeTruthy();
    within(dialog).getByRole("button", { name: "Try again" }).click();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
    expect(claimCalls()).toHaveLength(3);
  });

  it("[AXI4d] Escape answers Not now", async () => {
    openAuth();
    await acceptAsAlice();
    await screen.findByTestId("external-id-dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect((await acceptedPost()).externalIdDeclined).toBe(true);
  });

  it("[AXI5] the blinded value is never rendered, stored, or put in a URL", async () => {
    claimAnswers = [{ status: 201 }];
    openAuth();
    await screen.findByRole("button", { name: "Continue as alice" });
    expectNoBlindedValueAnywhere();
    await acceptAsAlice();
    const dialog = await screen.findByTestId("external-id-dialog");
    expectNoBlindedValueAnywhere();
    within(dialog).getByRole("button", { name: "Link" }).click();
    await acceptedPost();
    expectNoBlindedValueAnywhere();
    // Nor handed to the redirect.
    const [, redirectState] = flow.closeOrRedirect.mock.calls[0];
    expect(redirectState.returnURL ?? "").not.toContain(BLINDED);
  });

  it("[AXI6] (guard) without an external id: no lookup, no dialog, no flag", async () => {
    openAuth(null);
    await acceptAsAlice();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
    expect(lookupCalls()).toHaveLength(0);
    expect(claimCalls()).toHaveLength(0);
    expect(screen.queryByTestId("external-id-dialog")).toBeNull();
    expect(screen.queryByTestId("external-id-claimed")).toBeNull();
  });

  it("[AXI7] lookup failed (unknown): no dialog, no claim, no flag", async () => {
    lookupAnswer = "network-error";
    openAuth();
    await acceptAsAlice();
    const body = await acceptedPost();
    expect(body.externalIdDeclined).toBeUndefined();
    expect(claimCalls()).toHaveLength(0);
    expect(screen.queryByTestId("external-id-claimed")).toBeNull();
  });
});
