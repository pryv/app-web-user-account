// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/**
 * [ARG] `/auth` reached right after "Create account" in this window. Register
 * signs the new account in and hands `/auth` a one-shot marker: the request
 * continues with that session, without the "Welcome back" card meant for a
 * returning visitor. The card stays for a session stored before the request.
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

// The platform's info (delegation on or off) and the accounts the user controls.
const deleg = vi.hoisted(() => ({
  serviceInfo: {} as Record<string, unknown>,
  listControlled: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return { ...actual, Delegation: { fromConnection: () => ({ listControlled: deleg.listControlled }) } };
});

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      token: string;
      service = { info: async () => deleg.serviceInfo };
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
import { registeredState } from "../lib/signInCompletion";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const STORED_API = "https://alice-session@alice.core.test/";

function StateProbe() {
  const { state } = useLocation();
  return <p data-testid="history-state">{JSON.stringify(state ?? null)}</p>;
}

function openAuth(state: unknown, extra: Record<string, unknown> = {}) {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", STORED_API);
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId: "some-app",
    requestedPermissions: PERMS,
    serviceInfo: { api: "https://{username}.core.test/" },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/auth", search: "?poll=" + encodeURIComponent(POLL), state }]}>
      <SessionProvider>
        <Auth />
        <StateProbe />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[ARG] /auth right after creating an account in this window", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    deleg.serviceInfo = {};
    deleg.listControlled.mockReset();
    deleg.listControlled.mockResolvedValue([]);
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[ARG1] goes straight to the request with the new account, without \"Welcome back\"", async () => {
    openAuth(registeredState("alice"));
    await screen.findByRole("button", { name: "Accept" });
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(flow.checkAppAccess).toHaveBeenCalledTimes(1);
    expect(flow.checkAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://alice.core.test/", "alice-session"]);
  });

  it("[ARG2] the marker is one-shot: cleared from the history entry once read", async () => {
    openAuth(registeredState("alice"));
    await screen.findByRole("button", { name: "Accept" });
    await waitFor(() => expect(screen.getByTestId("history-state").textContent).toBe("null"));
  });

  it("[ARG3] (guard) a session stored before the request still gets the card", async () => {
    openAuth(null);
    await screen.findByText("Welcome back");
    screen.getByRole("button", { name: /continue as alice/i });
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
  });

  it("[ARG4] a marker for another account than the stored session: the card, nothing continued", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAuth(registeredState("bob"));
    await screen.findByText("Welcome back");
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
    // Said in the console, for a deployer whose registration lands on the card.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("not the account just created"))).toBe(true);
    warn.mockRestore();
  });

  /** A request for someone the user looks after, on a platform with delegation. */
  const MANAGED_ONLY = { actAs: "allow", actAsManagedOnly: true };

  it("[ARG5] the step that follows says the account is ready and what comes next", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    openAuth(registeredState("alice"), MANAGED_ONLY);
    const notice = await screen.findByTestId("grant-registered");
    expect(notice.textContent).toBe(
      "Your account alice is ready. Next, create the account of the person you look after: some-app will be given access to that account.",
    );
    // The notice already says it: no "you do not look after anyone yet".
    expect(screen.queryByText(/You do not look after anyone/)).toBeNull();
  });

  it("[ARG6] (guard) the same step for a session stored before the request: no notice", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    openAuth(null, MANAGED_ONLY);
    (await screen.findByRole("button", { name: /continue as alice/i })).click();
    await screen.findByText(/You do not look after anyone/);
    expect(screen.queryByTestId("grant-registered")).toBeNull();
  });

  it("[ARG7] (guard) a marker for another account than the one continuing: no notice naming it", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openAuth(registeredState("bob"), MANAGED_ONLY);
    (await screen.findByRole("button", { name: /continue as alice/i })).click();
    await screen.findByText(/You do not look after anyone/);
    expect(screen.queryByTestId("grant-registered")).toBeNull();
    warn.mockRestore();
  });
});
