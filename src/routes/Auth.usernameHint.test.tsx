// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * `/auth` honours the `username` sign-in hint, as `/signin` does. With no
 * stored session the form is pre-filled. With a stored session for someone
 * else, the form (pre-filled with the hint) comes first and the stored session
 * becomes a secondary "Continue as X instead", which still works and never
 * gets cleared by the hint. A matching hint, or none, keeps today's card. An
 * email hint never matches a username: it lands in the form.
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

// Controls the stored session's username lookup (a network call in real life).
const lookup = vi.hoisted(() => ({ fn: null as null | (() => Promise<string>) }));

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
        if (lookup.fn) return lookup.fn();
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const STORED_API = "https://alice-session@alice.core.test/";

function storeAlice() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", STORED_API);
}

function openAuth(hint: string | null) {
  flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN", requestingAppId: "some-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" } });
  const q = "/auth?poll=" + encodeURIComponent(POLL) + (hint != null ? "&username=" + encodeURIComponent(hint) : "");
  render(
    <MemoryRouter initialEntries={[q]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[AUH] /auth username hint", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    localStorage.clear();
    sessionStorage.clear();
    lookup.fn = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("[AUH1] no stored session: the form is pre-filled with the hint", async () => {
    openAuth("bob");
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob");
  });

  it("[AUH2] stored session for someone else: form pre-filled, the stored session offered second and still usable", async () => {
    storeAlice();
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    openAuth("bob");
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob");
    const instead = await screen.findByRole("button", { name: "Continue as alice instead" });
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe(STORED_API);
    instead.click();
    await waitFor(() => expect(flow.checkAppAccess).toHaveBeenCalled());
    expect(flow.checkAppAccess.mock.calls[0][1]).toBe("alice-session");
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe(STORED_API);
  });

  it("[AUH3] a hint matching the stored session (case, spaces) keeps the Continue card", async () => {
    storeAlice();
    openAuth(" Alice ");
    await screen.findByRole("button", { name: "Continue as alice" });
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("[AUH4] an email hint lands in the form, pre-filled", async () => {
    storeAlice();
    openAuth("bob@mail.test");
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob@mail.test");
    await screen.findByRole("button", { name: "Continue as alice instead" });
  });

  it("[AUH5] no hint: the stored session card is unchanged", async () => {
    storeAlice();
    openAuth(null);
    await screen.findByRole("button", { name: "Continue as alice" });
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("[AUH6] with a hint, the page waits for the stored name (loading card), then decides; a lookup that never answers is given up", async () => {
    storeAlice();
    let resolve: (u: string) => void = () => {};
    lookup.fn = () => new Promise<string>((r) => { resolve = r; });
    openAuth("bob");
    // Past the access-state load, the pending name lookup keeps the loading
    // card: neither the stored-session card nor the form flashes first.
    await waitFor(() => expect(flow.loadAccessState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
    resolve("alice");
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob");
    await screen.findByRole("button", { name: "Continue as alice instead" });
    cleanup();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    lookup.fn = () => new Promise<string>(() => {});
    openAuth("bob");
    await screen.findByText(/Loading/);
    vi.advanceTimersByTime(4000);
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob");
    expect(screen.queryByRole("button", { name: /Continue as/ })).toBeNull();
  });

  it("[AUH7] a stored session whose name cannot be looked up: the form, no secondary action, the session kept", async () => {
    storeAlice();
    lookup.fn = () => Promise.reject(new Error("offline"));
    openAuth("bob");
    expect(((await screen.findByLabelText("Username or email")) as HTMLInputElement).value).toBe("bob");
    expect(screen.queryByRole("button", { name: /Continue as/ })).toBeNull();
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe(STORED_API);
  });
});
