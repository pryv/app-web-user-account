// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` screen granting an app access on an account the signed-in user
 * controls (account delegation). Pinned here: when the "who is this for?"
 * selector appears, that the access is minted on the controlled account with
 * a delegate token, the hint posted to the register, and that the delegate
 * token never reaches browser storage.
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
vi.mock("../lib/accessFlow", () => flow);

const deleg = vi.hoisted(() => ({
  listControlled: vi.fn(),
  getToken: vi.fn(),
  serviceInfo: { features: { delegation: true } } as Record<string, unknown>,
}));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return {
    ...actual,
    Delegation: { fromConnection: () => ({ listControlled: deleg.listControlled, getToken: deleg.getToken }) },
  };
});

const PAT = "delegate-pat-secret";

vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({ onSignedIn }: { onSignedIn: (s: unknown) => void }) => (
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
            service: { info: async () => deleg.serviceInfo },
          },
        })
      }
    >
      sign-in-stub
    </button>
  ),
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";

function needSignin(extra: Record<string, unknown> = {}) {
  return { status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" }, ...extra };
}

async function signIn(state: Record<string, unknown>) {
  flow.loadAccessState.mockResolvedValue(state);
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  (await screen.findByText("sign-in-stub")).click();
}

function storageHolds(value: string): boolean {
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!;
      if (key.includes(value) || (store.getItem(key) ?? "").includes(value)) return true;
    }
  }
  return false;
}

describe("[AGF] /auth: grant for a controlled account", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.serviceInfo = { features: { delegation: true } };
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-kid", token: "kid-app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
      { relId: "r2", controlled: { username: "kid-b", hostSlug: "core-b" }, status: "invite", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AGF1] mints the access on the controlled account with a delegate token that is never stored", async () => {
    await signIn(needSignin({ actAs: "kid-a" }));
    await screen.findByText(/access to:/);
    expect(screen.queryByText("kid-b")).toBeNull(); // pending relationship: not offered
    const kid = screen.getByDisplayValue("kid-a") as HTMLInputElement;
    expect(kid.checked).toBe(true); // preselected from actAs
    screen.getByRole("button", { name: /continue for kid-a/i }).click();

    await screen.findByText(/is requesting permission/);
    expect(deleg.getToken).toHaveBeenCalledWith("kid-a");
    expect(flow.checkAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://kid-a.core.test/", PAT]);

    screen.getByRole("button", { name: /accept/i }).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(flow.createAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://kid-a.core.test/", PAT]);
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.username).toBe("kid-a");
    expect(posted.token).toBe("kid-app-token");
    expect(posted.delegation).toEqual({ isDelegatedAccess: true, controlledUsername: "kid-a", delegate: { username: "parent" } });
    expect(JSON.stringify(posted)).not.toContain(PAT);
    expect(storageHolds(PAT)).toBe(false);
    expect(storageHolds("parent-token")).toBe(true); // the owner's own session is kept as before
  });

  it("[AGF2] choosing the signed-in account grants as before, without a hint", async () => {
    await signIn(needSignin());
    await screen.findByText(/access to:/);
    expect((screen.getByDisplayValue("parent") as HTMLInputElement).checked).toBe(true);
    screen.getByRole("button", { name: /continue for parent/i }).click();
    await screen.findByText(/is requesting permission/);
    expect(deleg.getToken).not.toHaveBeenCalled();
    expect(flow.checkAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://parent.core.test/", "parent-token"]);
    screen.getByRole("button", { name: /accept/i }).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(flow.updateAccessState.mock.calls[0][1].delegation).toBeUndefined();
  });

  it("[AGF3] no selector when the app denies it, the platform does not run delegation, or nothing is controlled", async () => {
    for (const setup of [
      () => signIn(needSignin({ actAs: "deny" })),
      () => { deleg.serviceInfo = { features: {} }; return signIn(needSignin()); },
      () => { deleg.listControlled.mockResolvedValue([]); return signIn(needSignin()); },
    ]) {
      flow.checkAppAccess.mockClear();
      await setup();
      await screen.findByText(/is requesting permission/);
      expect(screen.queryByText(/access to:/)).toBeNull();
      expect(flow.checkAppAccess.mock.calls[0][1]).toBe("parent-token");
      cleanup();
    }
  });

  it("[AGF4] an existing access on the controlled account is described as delegated only when it was granted so", async () => {
    for (const [clientData, expectHint] of [[{ delegation: { kind: "delegated-child" } }, true], [null, false]] as const) {
      flow.updateAccessState.mockClear();
      flow.checkAppAccess.mockResolvedValue({ matchingAccess: { id: "m1", token: "existing", type: "app", permissions: PERMS, clientData } });
      await signIn(needSignin());
      await screen.findByText(/access to:/);
      (screen.getByDisplayValue("kid-a") as HTMLInputElement).click();
      screen.getByRole("button", { name: /continue for kid-a/i }).click();
      await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
      const posted = flow.updateAccessState.mock.calls[0][1];
      expect(posted.username).toBe("kid-a");
      expect(posted.delegation != null).toBe(expectHint);
      cleanup();
    }
  });

  it("[AGF5] a reload after this tab decided the request says it is complete", async () => {
    sessionStorage.setItem("pryv.auth.done:" + POLL, "1");
    flow.loadAccessState.mockRejectedValue(Object.assign(new Error("Invalid data from Access server (400)"), { status: 400 }));
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/This request is complete/);
    cleanup();
    // without the flag it is still reported as an error
    sessionStorage.clear();
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/Invalid data from Access server/);
  });

  it("[AGF6] a decided request is remembered for this tab", async () => {
    await signIn(needSignin({ actAs: "deny" }));
    await screen.findByText(/is requesting permission/);
    screen.getByRole("button", { name: /accept/i }).click();
    await waitFor(() => expect(flow.closeOrRedirect).toHaveBeenCalled());
    expect(sessionStorage.getItem("pryv.auth.done:" + POLL)).toBe("1");
  });
});
