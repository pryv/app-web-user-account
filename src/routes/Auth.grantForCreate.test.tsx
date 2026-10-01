// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` "who is this for?" step offering to create the account of
 * someone the user looks after. Pinned here: the step appears with a single
 * choice only when the app named `actAs`; the creation runs with the user's
 * OWN session; the new account joins the choices, selected, and nothing
 * continues on its own; an `actAs` naming an account the user does not manage
 * pre-fills the form; a session acting for another account is offered no
 * creation.
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

const deleg = vi.hoisted(() => ({
  listControlled: vi.fn(),
  getToken: vi.fn(),
  createAccount: vi.fn(),
  /** The connection each delegation client was built on, in order. */
  builtOn: [] as Array<{ apiEndpoint?: string }>,
  serviceInfo: { features: { delegation: true } } as Record<string, unknown>,
}));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return {
    ...actual,
    Delegation: {
      fromConnection: (connection: { apiEndpoint?: string }) => {
        deleg.builtOn.push(connection);
        return { listControlled: deleg.listControlled, getToken: deleg.getToken, createAccount: deleg.createAccount };
      },
    },
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
const TOGGLE = /create an account for someone you look after/i;

function needSignin(extra: Record<string, unknown> = {}) {
  return { status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" }, ...extra };
}

function openAuth(state: Record<string, unknown>) {
  flow.loadAccessState.mockResolvedValue(state);
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function signIn(state: Record<string, unknown>) {
  openAuth(state);
  (await screen.findByText("sign-in-stub")).click();
}

/** Open the creation form and submit it with `username`. */
async function createFromStep(username: string) {
  (await screen.findByRole("button", { name: TOGGLE })).click();
  const field = await waitFor(() => {
    const el = document.getElementById("managed-username") as HTMLInputElement | null;
    if (el == null) throw new Error("creation form not shown");
    return el;
  });
  fireEvent.change(field, { target: { value: username } });
  fireEvent.submit(field.closest("form")!);
}

describe("[GFC] /auth: create the managed account from the grant-for step", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.createAccount.mockReset();
    deleg.builtOn = [];
    deleg.serviceInfo = { features: { delegation: true } };
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-kiddo", token: "kid-app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    deleg.listControlled.mockResolvedValue([]);
    deleg.createAccount.mockResolvedValue({
      delegation: { relId: "r9", status: "active", controlled: { username: "kiddo", hostSlug: "core-b" } },
      apiEndpoint: "https://kiddo.core.test/",
    });
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kiddo.core.test/" });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[GFC1] actAs 'allow' and no managed account: the step shows one choice and the creation offer", async () => {
    await signIn(needSignin({ actAs: "allow" }));
    await screen.findByText(/access to:/);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect((screen.getByDisplayValue("parent") as HTMLInputElement).checked).toBe(true);
    const toggle = screen.getByRole("button", { name: TOGGLE });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/username/i)).toBeNull(); // collapsed
    toggle.click();
    await screen.findByText("A delegate has full control of this account:");
    expect(screen.getByRole("button", { name: /continue for parent/i })).toBeTruthy();
  });

  // Passes on the code before the creation offer existed too.
  it("[GFC2] (guard) no actAs: no step with a single choice, straight to the consent", async () => {
    for (const extra of [{}, { actAs: null }, { actAs: "" }, { actAs: "deny" }]) {
      flow.checkAppAccess.mockClear();
      await signIn(needSignin(extra));
      await screen.findByText(/is requesting permission/);
      expect(screen.queryByText(/access to:/), JSON.stringify(extra)).toBeNull();
      expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
      expect(flow.checkAppAccess.mock.calls[0][1]).toBe("parent-token");
      cleanup();
      localStorage.clear(); // the sign-in stored a session: start signed out again
    }
  });

  it("[GFC3] actAs naming an account the user does not manage: the line says so and the form is pre-filled", async () => {
    await signIn(needSignin({ actAs: "kiddo" }));
    await screen.findByText(/access to:/);
    expect(screen.getByText(/is not an account you can act for/).textContent).toContain("kiddo");
    expect(screen.getByRole("button", { name: TOGGLE }).getAttribute("aria-expanded")).toBe("true");
    expect((document.getElementById("managed-username") as HTMLInputElement).value).toBe("kiddo");
    expect(deleg.createAccount).not.toHaveBeenCalled(); // pre-filled, not submitted
  });

  it("[GFC4] a created account joins the choices, selected, and nothing continues on its own", async () => {
    await signIn(needSignin({ actAs: "allow" }));
    await createFromStep("kiddo");

    await screen.findByText(/Account kiddo created and selected/);
    expect(deleg.createAccount).toHaveBeenCalledTimes(1);
    expect(deleg.createAccount.mock.calls[0][0]).toMatchObject({ username: "kiddo" });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect((screen.getByDisplayValue("kiddo") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: TOGGLE }).getAttribute("aria-expanded")).toBe("false");
    // No automatic continue: no delegate token, no check-app yet.
    expect(deleg.getToken).not.toHaveBeenCalled();
    expect(flow.checkAppAccess).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /continue for kiddo/i }).click();
    await screen.findByText(/is requesting permission/);
    expect(deleg.getToken).toHaveBeenCalledWith("kiddo");
    expect(flow.checkAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://kiddo.core.test/", PAT]);
  });

  it("[GFC5] the form submits with the user's own session, never a delegate token", async () => {
    await signIn(needSignin({ actAs: "allow" }));
    await createFromStep("kiddo");
    await screen.findByText(/Account kiddo created and selected/);
    // Every delegation client on this page was built on the signed-in session.
    expect(deleg.builtOn.length).toBeGreaterThan(0);
    for (const conn of deleg.builtOn) expect(conn.apiEndpoint).toBe("https://parent-token@parent.core.test/");
    expect(deleg.getToken).not.toHaveBeenCalled();
    expect(JSON.stringify(deleg.createAccount.mock.calls)).not.toContain(PAT);
  });

  it("[GFC6] a session acting for another account is offered no creation", async () => {
    localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
    localStorage.setItem("pryv.session.apiEndpoint", "https://kid-session@kid-a.core.test/");
    localStorage.setItem("pryv.session.parent.apiEndpoint", "https://parent-token@parent.core.test/");
    localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kid-a", parentUsername: "parent" }));
    deleg.listControlled.mockResolvedValue([{ relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 }]);
    openAuth(needSignin({ actAs: "allow" }));
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    await screen.findByText(/access to:/);
    expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
    expect(deleg.createAccount).not.toHaveBeenCalled();
  });
});
