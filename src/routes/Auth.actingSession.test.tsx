// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` screen when the account pages are acting for a controlled
 * account. The grant starts from the session of the account acting, so the
 * selector offers the controlled account (preselected) and the app's `actAs`
 * is honoured; the acting session is never used as if it were the user's own.
 * Also pinned: an access that carries the lineage marker is always described
 * to the app as delegated, whichever path minted or reused it.
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

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      token: string;
      service = { info: async () => ({ features: { delegation: true } }) };
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
const PAT = "delegate-pat-secret";
const MARKER = { delegation: { kind: "delegated-child", relId: "r1", delegate: { username: "parent", hostSlug: "core-a" }, viaAccessId: "pat1" } };

function storeSession(acting: boolean) {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://kid-session@kid-a.core.test/");
  if (acting) {
    localStorage.setItem("pryv.session.parent.apiEndpoint", "https://parent-token@parent.core.test/");
    localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kid-a", parentUsername: "parent" }));
  }
}

async function openAuth(extra: Record<string, unknown> = {}) {
  flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" }, ...extra });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[AAS] /auth while the account pages act for a controlled account", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    flow.createAppAccess.mockResolvedValue({ id: "acc-kid", token: "kid-app-token", type: "app", permissions: PERMS, clientData: MARKER });
    deleg.listControlled.mockResolvedValue([{ relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 }]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AAS1] continues as the account acting, with the controlled account preselected", async () => {
    storeSession(true);
    await openAuth();
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    await screen.findByText(/access to:/);
    expect((screen.getByDisplayValue("kid-a") as HTMLInputElement).checked).toBe(true);
    screen.getByRole("button", { name: /continue for kid-a/i }).click();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(deleg.getToken).toHaveBeenCalledWith("kid-a");
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.username).toBe("kid-a");
    expect(posted.delegation).toEqual({ isDelegatedAccess: true, controlledUsername: "kid-a", delegate: { username: "parent" } });
    expect(JSON.stringify(posted)).not.toContain(PAT);
    expect(JSON.stringify(posted)).not.toContain("kid-session");
  });

  it("[AAS2] an app that denies acting for another account gets the acting account's own grant", async () => {
    storeSession(true);
    await openAuth({ actAs: "deny" });
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(screen.queryByText(/access to:/)).toBeNull();
    expect(flow.createAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://parent.core.test/", "parent-token"]);
    expect(flow.updateAccessState.mock.calls[0][1].username).toBe("parent");
  });

  it("[AAS3] an account the app names is preselected over the one the pages act for", async () => {
    storeSession(true);
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
      { relId: "r2", controlled: { username: "kid-b", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    await openAuth({ actAs: "kid-b" });
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    await screen.findByText(/access to:/);
    expect((screen.getByDisplayValue("kid-b") as HTMLInputElement).checked).toBe(true);
  });

  it("[AAS4] a session on the controlled account: an access carrying the marker is still described as delegated", async () => {
    storeSession(false);
    deleg.listControlled.mockResolvedValue([]);
    await openAuth();
    (await screen.findByRole("button", { name: /continue as kid-a/i })).click();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.username).toBe("kid-a");
    expect(posted.delegation).toEqual({ isDelegatedAccess: true, controlledUsername: "kid-a", delegate: { username: "parent" } });
  });

  it("[AAS5] a reused access is described as delegated only when it carries the marker", async () => {
    for (const [clientData, expectHint] of [[MARKER, true], [null, false]] as const) {
      storeSession(false);
      deleg.listControlled.mockResolvedValue([]);
      flow.updateAccessState.mockClear();
      flow.checkAppAccess.mockResolvedValue({ matchingAccess: { id: "m1", token: "existing", type: "app", permissions: PERMS, clientData } });
      await openAuth();
      (await screen.findByRole("button", { name: /continue as kid-a/i })).click();
      await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
      expect(flow.updateAccessState.mock.calls[0][1].delegation != null).toBe(expectHint);
      cleanup();
      localStorage.clear();
      sessionStorage.clear();
    }
  });
});
