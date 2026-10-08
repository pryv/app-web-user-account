// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [CMRD] Redirect mode of the cross-account hand-offs (`/cmc-accept`,
 * `/cmc-scope-update`) under the operator's return policy: none set, the
 * browser goes back to any `returnUrl` as before; with one, listed origins are
 * followed and others get a link to click (`confirm`) or a notice (`stay`).
 */

const PENDING_REQUEST = { event: { content: { newPermissions: [{ streamId: "diary", level: "read" }], message: "More, please." } } };

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        this.endpoint = apiEndpoint;
      }
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
      async api() {
        return [PENDING_REQUEST];
      }
    },
  },
}));

const cmcMock = vi.hoisted(() => ({
  readOffer: vi.fn(),
  acceptInvite: vi.fn(),
  refuseInvite: vi.fn(),
  acceptScopeUpdate: vi.fn(),
}));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("../lib/returnTarget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/returnTarget")>();
  return { ...actual, navigateTo: nav.navigateTo };
});

import CmcApprove from "./CmcApprove";
import CmcScopeUpdate from "./CmcScopeUpdate";
import { SessionProvider } from "../lib/session";
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";

function signedIn() {
  localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.core.test/");
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
}

function renderAt(path: string, query: Record<string, string>) {
  const q = new URLSearchParams(query);
  render(
    <MemoryRouter initialEntries={[`${path}?${q.toString()}`]}>
      <SessionProvider>
        <Routes>
          <Route path="/cmc-accept" element={<CmcApprove />} />
          <Route path="/cmc-scope-update" element={<CmcScopeUpdate />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

function acceptPage(returnUrl: string, mode = "redirect") {
  cmcMock.readOffer.mockResolvedValue({
    requester: { username: "bob", host: "requester.test" },
    requestedPermissions: [{ streamId: "diary", level: "read" }],
    mode: "open",
  });
  cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "acc-1" });
  cmcMock.refuseInvite.mockResolvedValue({});
  renderAt("/cmc-accept", { capabilityUrl: "https://cap@requester.test/", scopeStreamId: "s1", mode, returnUrl });
}

async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}

describe("[CMRD] cross-account hand-off redirect mode", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    nav.navigateTo.mockReset();
    Object.values(cmcMock).forEach((m) => m.mockReset());
    _setDeployedSettingsForTest(null);
  });

  function policy(otherOrigins: "follow" | "confirm" | "stay") {
    _setDeployedSettingsForTest({ returnPolicy: { trustedOrigins: ["https://app.example.org"], otherOrigins } });
  }

  function navigatedTo(): URL {
    return new URL(nav.navigateTo.mock.calls[0][0] as string);
  }

  it("[CMD1] without a return policy, /cmc-accept returns to any returnUrl as before", async () => {
    signedIn();
    acceptPage("https://example.org/back?x=1");
    await click("Approve");
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(navigatedTo().origin).toBe("https://example.org");
    expect(navigatedTo().searchParams.get("x")).toBe("1");
    expect(JSON.parse(navigatedTo().searchParams.get("cmcAcceptResult") ?? "{}")).toEqual({ ok: true, acceptEventId: "acc-1" });
  });

  it("[CMD2] with a policy, a listed origin is returned to automatically", async () => {
    policy("stay");
    signedIn();
    acceptPage("https://app.example.org/back");
    await click("Decline");
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(JSON.parse(navigatedTo().searchParams.get("cmcAcceptResult") ?? "{}")).toEqual({ ok: false, reason: "declined-by-user" });
  });

  it("[CMD3] confirm: another origin gets a link to click, carrying the outcome", async () => {
    policy("confirm");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signedIn();
    acceptPage("https://example.org/back");
    await click("Approve");
    const link = (await screen.findByTestId("return-link")) as HTMLAnchorElement;
    expect(link.textContent).toBe("Return to example.org");
    const href = new URL(link.href);
    expect(href.origin).toBe("https://example.org");
    expect(JSON.parse(href.searchParams.get("cmcAcceptResult") ?? "{}")).toEqual({ ok: true, acceptEventId: "acc-1" });
    expect(nav.navigateTo).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("[CMD4] stay: another origin is not followed, the page says so", async () => {
    policy("stay");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signedIn();
    acceptPage("https://example.org/");
    await click("Approve");
    expect(await screen.findByTestId("return-refused")).toBeTruthy();
    expect(screen.getByText("Request approved")).toBeTruthy();
    expect(screen.queryByTestId("return-link")).toBeNull();
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("https://example.org");
    warn.mockRestore();
  });

  it("[CMD5] /cmc-scope-update follows the same policy (none set: returns as before)", async () => {
    cmcMock.acceptScopeUpdate.mockResolvedValue({ updateAcceptEventId: "upd-1" });
    signedIn();
    renderAt("/cmc-scope-update", { scopeRequestEventId: "req-1", scopeStreamId: "s1", mode: "redirect", returnUrl: "https://example.org/back" });
    await screen.findByText("More, please.");
    await click("Approve");
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledTimes(1));
    expect(JSON.parse(navigatedTo().searchParams.get("cmcScopeUpdateResult") ?? "{}")).toMatchObject({ ok: true, updateEventId: "upd-1", action: "accept" });
  });

  it("[CMD6] /cmc-scope-update with stay: not followed, the page says so", async () => {
    policy("stay");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cmcMock.acceptScopeUpdate.mockResolvedValue({ updateAcceptEventId: "upd-1" });
    signedIn();
    renderAt("/cmc-scope-update", { scopeRequestEventId: "req-1", scopeStreamId: "s1", mode: "redirect", returnUrl: "https://example.org/" });
    await screen.findByText("More, please.");
    await click("Approve");
    expect(await screen.findByTestId("return-refused")).toBeTruthy();
    expect(nav.navigateTo).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("[CMD7] popup mode is unchanged: no navigation, no notice", async () => {
    policy("stay");
    signedIn();
    acceptPage("https://example.org/", "popup");
    await click("Approve");
    await screen.findByText("Request approved");
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("return-refused")).toBeNull();
    expect(screen.queryByTestId("return-link")).toBeNull();
  });
});
