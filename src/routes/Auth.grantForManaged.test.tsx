// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` "who is this for?" step when the app asked for an account the
 * user manages (`actAsManagedOnly: true` echoed on the poll state). Pinned
 * here: the signed-in account is never offered nor granted; nothing is
 * preselected unless named, and Continue waits for a choice; with no managed
 * account the creation form opens at once; a session acting for a managed
 * account keeps it preselected; when no managed account can be used the page
 * says why and Cancel refuses with `MANAGED_ACCOUNT_UNAVAILABLE`.
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
  /** null: the platform's info cannot be read. */
  serviceInfo: { features: { delegation: true } } as Record<string, unknown> | null,
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
            service: {
              info: async () => {
                if (deleg.serviceInfo == null) throw new TypeError("Failed to fetch");
                return deleg.serviceInfo;
              },
            },
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

// Lets one test force what `grantStep` answers, to pin the page's own guard.
const stepOverride = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../lib/grantFor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grantFor")>();
  return {
    ...actual,
    grantStep: (input: Parameters<typeof actual.grantStep>[0]) =>
      stepOverride.value != null ? stepOverride.value : actual.grantStep(input),
  };
});

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

const CONTINUE = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const KIDS = [
  { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
  { relId: "r2", controlled: { username: "kid-c", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
];

function actingSession() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://kid-session@kid-a.core.test/");
  localStorage.setItem("pryv.session.parent.apiEndpoint", "https://parent-token@parent.core.test/");
  localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kid-a", parentUsername: "parent" }));
}

function refusal(): Record<string, unknown> {
  return flow.updateAccessState.mock.calls[0][1] as Record<string, unknown>;
}

describe("[AMO] /auth: the app asks for an account the user manages", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.createAccount.mockReset();
    deleg.builtOn = [];
    deleg.serviceInfo = { features: { delegation: true } };
    stepOverride.value = null;
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockResolvedValue({ id: "acc-kid", token: "kid-app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    deleg.listControlled.mockResolvedValue(KIDS);
    deleg.createAccount.mockResolvedValue({
      delegation: { relId: "r9", status: "active", controlled: { username: "kiddo", hostSlug: "core-b" } },
      apiEndpoint: "https://kiddo.core.test/",
    });
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AMO1] a platform without delegation: says why, Cancel only, refused with MANAGED_ACCOUNT_UNAVAILABLE", async () => {
    deleg.serviceInfo = { features: {} };
    await signIn(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    await screen.findByText(/needs access for someone you look after/);
    screen.getByText(/not available here/);
    // Nothing to continue with: no account choice, no Accept, no sign-in form.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel"]);
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
    CONTINUE("Cancel").click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalledTimes(1));
    expect(refusal()).toMatchObject({ status: "REFUSED", reasonId: "MANAGED_ACCOUNT_UNAVAILABLE" });
    expect(refusal().message).toMatch(/not available on this platform/);
    expect(flow.closeOrRedirect).toHaveBeenCalled();
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(deleg.listControlled).not.toHaveBeenCalled();
  });

  it("[AMO2] a session acting for a managed account whose listing fails: the cause is named, never its own account", async () => {
    actingSession();
    deleg.listControlled.mockRejectedValue(new TypeError("Failed to fetch"));
    openAuth(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    await screen.findByText(/could not be listed/);
    CONTINUE("Cancel").click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalledTimes(1));
    expect(refusal()).toMatchObject({ status: "REFUSED", reasonId: "MANAGED_ACCOUNT_UNAVAILABLE" });
    expect(refusal().message).toMatch(/could not be listed/);
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
  });

  it("[AMO3] only managed accounts, none preselected: Continue waits for a choice, then grants on it", async () => {
    await signIn(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    await screen.findByText(/access to:/);
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["kid-a", "kid-c"]);
    for (const r of screen.getAllByRole("radio")) expect((r as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("button", { name: /continue for parent/i })).toBeNull();
    expect(CONTINUE("Continue").disabled).toBe(true);
    // The reason it is disabled is reachable from the button itself.
    const hintId = CONTINUE("Continue").getAttribute("aria-describedby");
    expect(hintId != null && document.getElementById(hintId)?.textContent).toMatch(/Choose the account/);
    (screen.getByDisplayValue("kid-c") as HTMLInputElement).click();
    await waitFor(() => expect(CONTINUE(/continue for kid-c/i).disabled).toBe(false));
    CONTINUE(/continue for kid-c/i).click();
    await screen.findByText(/is requesting permission/);
    expect(deleg.getToken).toHaveBeenCalledWith("kid-c");
    expect(flow.checkAppAccess.mock.calls[0][1]).toBe(PAT);
  });

  it("[AMO4] no managed account yet: the creation form is open at once, and the account created is selected", async () => {
    deleg.listControlled.mockResolvedValue([]);
    await signIn(needSignin({ actAs: "kiddo", actAsManagedOnly: true }));
    await screen.findByText(/access to:/);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: TOGGLE }).getAttribute("aria-expanded")).toBe("true");
    const field = document.getElementById("managed-username") as HTMLInputElement;
    expect(field.value).toBe("kiddo");
    expect(CONTINUE("Continue").disabled).toBe(true);
    fireEvent.submit(field.closest("form")!);
    await screen.findByText(/Account kiddo created and selected/);
    expect((screen.getByDisplayValue("kiddo") as HTMLInputElement).checked).toBe(true);
    expect(CONTINUE(/continue for kiddo/i).disabled).toBe(false);
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
  });

  it("[AMO5] a session acting for a managed account keeps it preselected, without the creation offer", async () => {
    actingSession();
    openAuth(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    (await screen.findByRole("button", { name: /continue as parent/i })).click();
    await screen.findByText(/access to:/);
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["kid-a", "kid-c"]);
    expect((screen.getByDisplayValue("kid-a") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
    expect(CONTINUE(/continue for kid-a/i).disabled).toBe(false);
  });

  it("[AMO7] the page itself never falls back to the signed-in account, whatever the step concluded", async () => {
    deleg.serviceInfo = { features: {} };
    // A step to choose from, but no delegation client to work with: nothing to grant on.
    stepOverride.value = { kind: "choose", targets: [{ username: "kid-a", self: false }], selected: "kid-a", listFailed: false, createOpen: false };
    await signIn(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    await screen.findByText(/needs access for someone you look after/);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel"]);
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
  });

  it("[AMO8] the app named the signed-in account: not called \"an account you can act for\"", async () => {
    await signIn(needSignin({ actAs: "parent", actAsManagedOnly: true }));
    await screen.findByText(/access to:/);
    expect(screen.queryByText(/is not an account you can act for/)).toBeNull();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["kid-a", "kid-c"]);
  });

  it("[AMO9] the platform's info cannot be read: said so, Cancel names that cause", async () => {
    deleg.serviceInfo = null;
    await signIn(needSignin({ actAs: "allow", actAsManagedOnly: true }));
    await screen.findByText(/could not be checked right now/);
    CONTINUE("Cancel").click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalledTimes(1));
    expect(refusal()).toMatchObject({ status: "REFUSED", reasonId: "MANAGED_ACCOUNT_UNAVAILABLE" });
    expect(refusal().message).toMatch(/information could not be read/);
  });

  it("[AMO6] (guard) an echo other than true, or none (older core): the step as before, own account included", async () => {
    for (const extra of [{}, { actAsManagedOnly: "true" }, { actAsManagedOnly: false }]) {
      await signIn(needSignin({ actAs: "allow", ...extra }));
      await screen.findByText(/access to:/);
      expect((screen.getByDisplayValue("parent") as HTMLInputElement).checked, JSON.stringify(extra)).toBe(true);
      expect(screen.queryByText(/needs access for someone you look after/)).toBeNull();
      cleanup();
      localStorage.clear();
    }
  });
});
