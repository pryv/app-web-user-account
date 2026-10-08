// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [AGTE] The operator's sign-in gate on `/auth`: "Continue as" goes to the
 * gate page first when it names one, keeping the request; coming back, the
 * request continues with that account without "Welcome back" again.
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

vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return { ...actual, Delegation: { fromConnection: () => ({ listControlled: async () => [] }) } };
});

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

const gate = vi.hoisted(() => ({ pendingAccountActs: vi.fn() }));
vi.mock("../extensions/signInGate", () => gate);

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";
import { resumeState } from "../lib/signInCompletion";
import { takeAccountActsResume } from "../lib/accountActsGate";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const SEARCH = "?poll=" + encodeURIComponent(POLL);

function GateProbe() {
  const { pathname } = useLocation();
  return <p data-testid="gate-page">{pathname}</p>;
}

function openAuth(state: unknown) {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://alice-session@alice.core.test/");
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId: "some-app",
    requestedPermissions: PERMS,
    serviceInfo: { api: "https://{username}.core.test/" },
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/auth", search: SEARCH, state }]}>
      <SessionProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/legal-acts" element={<GateProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[AGTE] /auth and the sign-in gate", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    gate.pendingAccountActs.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AGT1] \"Continue as\" with a pending act goes to the gate page first, keeping the request", async () => {
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    openAuth(null);
    fireEvent.click(await screen.findByRole("button", { name: /continue as alice/i }));
    expect((await screen.findByTestId("gate-page")).textContent).toBe("/legal-acts");
    expect(flow.checkAppAccess).not.toHaveBeenCalled();
    expect(takeAccountActsResume()).toEqual({
      target: { kind: "internal", path: "/auth" + SEARCH },
      replace: true,
      state: { resumeAs: "alice" },
    });
  });

  it("[AGT2] back from the gate page, the request continues as that account without \"Welcome back\"", async () => {
    gate.pendingAccountActs.mockResolvedValue(null);
    openAuth(resumeState("alice"));
    await screen.findByRole("button", { name: "Accept" });
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(gate.pendingAccountActs).toHaveBeenCalledTimes(1);
    expect(flow.checkAppAccess.mock.calls[0].slice(0, 2)).toEqual(["https://alice.core.test/", "alice-session"]);
  });

  it("[AGT3] (guard) a resume marker for another account than the stored session: the card", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    gate.pendingAccountActs.mockResolvedValue(null);
    openAuth(resumeState("bob"));
    await screen.findByText("Welcome back");
    await waitFor(() => expect(flow.checkAppAccess).not.toHaveBeenCalled());
    warn.mockRestore();
  });
});
