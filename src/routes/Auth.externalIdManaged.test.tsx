// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [AXI9] `/auth` with an external id (hint mode), granted on an account the
 * signed-in user manages: nothing is asked and no `externalIdDeclined` is
 * posted. Linking needs that account's own personal token, which the page
 * does not hold and must not mint; the delegate token is not used for it.
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

const deleg = vi.hoisted(() => ({ listControlled: vi.fn(), getToken: vi.fn() }));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return {
    ...actual,
    Delegation: { fromConnection: () => ({ listControlled: deleg.listControlled, getToken: deleg.getToken }) },
  };
});

const PAT = "delegate-pat-secret";
const BLINDED = "blinded-managed-secret-value";

vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({ onSignedIn, externalError, notice }: { onSignedIn: (s: unknown) => void; externalError?: string | null; notice?: unknown }) => (
    <>
    {externalError != null && <p>{externalError}</p>}
    {notice as never}
    <button
      type="button"
      onClick={() =>
        void onSignedIn({
          username: "parent",
          personalToken: "parent-token",
          endpoint: "https://parent.core.test/",
          connection: {
            apiEndpoint: "https://parent-token@parent.core.test/",
            endpoint: "https://parent.core.test/",
            username: async () => "parent",
            service: { info: async () => ({ features: { delegation: true } }) },
          },
        })
      }
    >
      sign-in-stub
    </button>
    </>
  ),
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const REGISTER = "https://reg.core.test/";

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  // The lookup: no account holds the id, so on the user's own account the
  // page would ask.
  const status = String(input) === REGISTER + "ext-id/cores" ? 404 : 500;
  return { status, ok: false, json: async () => ({}) } as Response;
});

describe("[AXI9] /auth with an external id, granted on a managed account", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-kid", token: "kid-app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("[AXI9] nothing is asked, nothing is claimed, no externalIdDeclined", async () => {
    flow.loadAccessState.mockResolvedValue({
      status: "NEED_SIGNIN",
      requestingAppId: "kid-app",
      requestedPermissions: PERMS,
      actAs: "kid-a",
      serviceInfo: { api: "https://{username}.core.test/", register: REGISTER },
      externalId: { namespace: "clinic-a", label: "Clinic A", blindedValue: BLINDED, mode: "hint" },
    });
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    // The lookup ran and said no account holds it.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === REGISTER + "ext-id/cores")).toBe(true));
    (await screen.findByText("sign-in-stub")).click();
    (await screen.findByRole("button", { name: /continue for kid-a/i })).click();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.username).toBe("kid-a");
    expect(posted.externalIdDeclined).toBeUndefined();
    expect(screen.queryByTestId("external-id-dialog")).toBeNull();
    // No claim, with either token.
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("account/external-ids"))).toBe(false);
    expect(document.body.innerHTML).not.toContain(BLINDED);
  });

  it("[AXI9b] forced, refused for the managed account (not-holder): the notice names that account, not the signed-in one", async () => {
    flow.updateAccessState.mockResolvedValue({ status: 400, errorId: "external-id-mismatch", reason: "not-holder" });
    flow.loadAccessState.mockResolvedValue({
      status: "NEED_SIGNIN",
      requestingAppId: "kid-app",
      requestedPermissions: PERMS,
      actAs: "kid-a",
      serviceInfo: { api: "https://{username}.core.test/", register: REGISTER },
      externalId: { namespace: "clinic-a", label: "Clinic A", blindedValue: BLINDED, mode: "forced" },
    });
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    (await screen.findByRole("button", { name: /continue for kid-a/i })).click();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(await screen.findByText("The account kid-a is not the one linked to Clinic A. Nothing was granted.")).toBeTruthy();
    expect(screen.queryByText(/The account parent is not/)).toBeNull();
    expect(document.body.innerHTML).not.toContain(BLINDED);
  });
});
