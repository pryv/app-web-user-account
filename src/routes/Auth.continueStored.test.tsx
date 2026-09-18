// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * "Continue as" on the `/auth` popup with a stored session. The session is
 * dropped only when the platform rejected its token; a network error or a
 * server failure keeps it, so the user can retry and the account pages stay
 * signed in.
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
const STORED_API = "https://alice-session@alice.core.test/";

async function openAuth() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", STORED_API);
  flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN", requestingAppId: "some-app", requestedPermissions: PERMS, serviceInfo: { api: "https://{username}.core.test/" } });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  (await screen.findByRole("button", { name: /continue as alice/i })).click();
}

describe("[PCS] /auth continue with the stored session", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[PCS1] a rejected token (401) signs the stored session out", async () => {
    flow.checkAppAccess.mockRejectedValue(Object.assign(new Error("check-app failed (401)"), { status: 401 }));
    await openAuth();
    await screen.findByText(/previous session is no longer valid/i);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
    expect(screen.queryByRole("button", { name: /continue as alice/i })).toBeNull();
  });

  it("[PCS2] an invalid-access-token error id signs the stored session out", async () => {
    flow.checkAppAccess.mockRejectedValue(Object.assign(new Error("check-app failed (400)"), { status: 400, id: "invalid-access-token" }));
    await openAuth();
    await screen.findByText(/previous session is no longer valid/i);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
  });

  it("[PCS3] a network error keeps the session and offers a retry", async () => {
    flow.checkAppAccess.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await openAuth();
    await screen.findByText(/could not reach the server, please try again/i);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe(STORED_API);
    const retry = screen.getByRole("button", { name: /continue as alice/i }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    // The retry goes through once the server answers.
    flow.checkAppAccess.mockResolvedValueOnce({ checkedPermissions: PERMS });
    retry.click();
    await screen.findByRole("button", { name: /accept/i });
    expect(flow.checkAppAccess).toHaveBeenCalledTimes(2);
  });

  it("[PCS4] a server failure (503) keeps the session", async () => {
    flow.checkAppAccess.mockRejectedValue(Object.assign(new Error("check-app failed (503)"), { status: 503 }));
    await openAuth();
    await screen.findByText(/could not reach the server, please try again/i);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBe(STORED_API);
    expect(screen.getByRole("button", { name: /continue as alice/i })).toBeTruthy();
  });
});
