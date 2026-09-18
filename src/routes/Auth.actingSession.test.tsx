// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` screen when the stored session is already acting for a
 * controlled account (the account pages' "acting as"): the grant goes through
 * "Continue as", without the selector, and the access the delegate token
 * mints carries the lineage marker. The app must still be told it is a
 * delegated grant.
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

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      token: string;
      service = { info: async () => ({ features: {} }) };
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        const url = new URL(apiEndpoint);
        this.token = url.username;
        url.username = "";
        this.endpoint = url.toString();
      }
      async username() {
        return "kid-a";
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const MARKER = { delegation: { kind: "delegated-child", relId: "r1", delegate: { username: "parent", hostSlug: "core-a" }, viaAccessId: "pat1" } };

function actingAsKid() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://kid-pat@kid-a.core.test/");
  localStorage.setItem("pryv.session.parent.apiEndpoint", "https://parent-token@parent.core.test/");
  localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kid-a", parentUsername: "parent" }));
}

async function continueAsStored() {
  flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" } });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  (await screen.findByRole("button", { name: /continue as kid-a/i })).click();
}

describe("[AAS] /auth with a session acting for a controlled account", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    localStorage.clear();
    sessionStorage.clear();
    actingAsKid();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AAS1] says whom the session acts for", async () => {
    flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" } });
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /continue as kid-a/i });
    expect(screen.getByText(/\(via parent\)/)).toBeTruthy();
  });

  it("[AAS2] a fresh access carrying the lineage marker is posted with the delegation hint", async () => {
    flow.createAppAccess.mockResolvedValue({ id: "acc-kid", token: "kid-app-token", type: "app", permissions: PERMS, clientData: MARKER });
    await continueAsStored();
    (await screen.findByRole("button", { name: /accept/i })).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.username).toBe("kid-a");
    expect(posted.delegation).toEqual({ isDelegatedAccess: true, controlledUsername: "kid-a", delegate: { username: "parent" } });
    expect(JSON.stringify(posted)).not.toContain("kid-pat");
  });

  it("[AAS3] an existing access is described as delegated only when it carries the marker", async () => {
    for (const [clientData, expectHint] of [[MARKER, true], [null, false]] as const) {
      flow.updateAccessState.mockClear();
      flow.checkAppAccess.mockResolvedValue({ matchingAccess: { id: "m1", token: "existing", type: "app", permissions: PERMS, clientData } });
      await continueAsStored();
      await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
      expect(flow.updateAccessState.mock.calls[0][1].delegation != null).toBe(expectHint);
      cleanup();
      sessionStorage.clear();
    }
  });
});
