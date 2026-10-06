// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [SUAS] /cmc-scope-update: the account that answers. The page answers with
 * the session this browser holds, so, as /cmc-accept, it names the signed-in
 * account above Approve / Decline with a way to switch, offers neither until
 * that account is known, and, when the calling app names the account it
 * expects (`username=`) and the session is another one, asks to switch
 * account instead.
 */

/** When set, answers `username()` in place of the endpoint's host label. */
const lookup = vi.hoisted(() => ({ impl: null as null | (() => Promise<string>) }));

/** The scope request as `events.getOne` returns it (a result row). */
const PENDING_REQUEST = { event: { content: { newPermissions: [{ streamId: "diary", level: "read" }], message: "More, please." } } };
const request = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));

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
        if (lookup.impl) return lookup.impl();
        const name = new URL(this.apiEndpoint).hostname.split(".")[0];
        if (name === "unreachable") throw new Error("network down");
        return name;
      }
      async api() {
        return [request.row ?? PENDING_REQUEST];
      }
    },
  },
}));

const cmcMock = vi.hoisted(() => ({ acceptScopeUpdate: vi.fn(), refuseScopeUpdate: vi.fn() }));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

import CmcScopeUpdate from "./CmcScopeUpdate";
import { SessionProvider } from "../lib/session";

const SERVICE_INFO_URL = "https://core.test/reg/service/info";

function signedIn(api = "https://tok@alice.core.test/") {
  localStorage.setItem("pryv.session.apiEndpoint", api);
  localStorage.setItem("pryv.session.serviceInfoUrl", SERVICE_INFO_URL);
}

/** Stands in for /signin: shows where the page was sent. */
function SignInProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="signin-probe">{pathname + search}</p>;
}

function renderPage(extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ scopeRequestEventId: "req-1", scopeStreamId: "s1", ...extra });
  render(
    <MemoryRouter initialEntries={[`/cmc-scope-update?${q.toString()}`]}>
      <SessionProvider>
        <Routes>
          <Route path="/cmc-scope-update" element={<CmcScopeUpdate />} />
          <Route path="/signin" element={<SignInProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

/** The proposal is read: the page is ready to answer. */
async function proposalShown() {
  await screen.findByText("More, please.");
}

/** The /signin target the page navigated to, as query params. */
async function signInTarget(): Promise<URLSearchParams> {
  const probe = await screen.findByTestId("signin-probe");
  const target = probe.textContent ?? "";
  expect(target.startsWith("/signin?")).toBe(true);
  return new URLSearchParams(target.slice("/signin".length));
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("[SUAS] /cmc-scope-update names the account that answers", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    lookup.impl = null;
    request.row = null;
    localStorage.clear();
    cmcMock.acceptScopeUpdate.mockReset();
    cmcMock.refuseScopeUpdate.mockReset();
  });

  it("[SUA1] states the signed-in account above Approve, with a way to switch", async () => {
    signedIn();
    renderPage();
    await proposalShown();
    const line = await screen.findByTestId("cmc-approving-as");
    expect(line.textContent).toContain("You are approving as alice.");
    expect(line.querySelector("strong")?.textContent).toBe("alice");
    expect(button("Not you? Switch account")).toBeTruthy();
    expect(button("Approve").disabled).toBe(false);
    expect(button("Decline").disabled).toBe(false);
  });

  it("[SUA2] Switch account signs out and returns to the same request after sign-in", async () => {
    signedIn();
    renderPage({ mode: "popup", returnUrl: "https://app.test/" });
    fireEvent.click(await screen.findByRole("button", { name: "Not you? Switch account" }));
    const target = await signInTarget();
    expect(target.get("next")).toBe("/cmc-scope-update");
    expect(target.get("scopeRequestEventId")).toBe("req-1");
    expect(target.get("scopeStreamId")).toBe("s1");
    expect(target.get("mode")).toBe("popup");
    expect(target.get("returnUrl")).toBe("https://app.test/");
    // The platform of the session that was signed out is kept for the sign-in.
    expect(target.get("pryvServiceInfoUrl")).toBe(SERVICE_INFO_URL);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
  });

  it("[SUA3] another account than the one the app expects: asks to switch, offers no Approve", async () => {
    signedIn();
    renderPage({ username: "carol" });
    const block = await screen.findByTestId("cmc-switch-account");
    expect(block.textContent).toContain("This request is for carol, but you are signed in as alice.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    const target = await signInTarget();
    // The sign-in form is pre-filled with the expected account.
    expect(target.get("username")).toBe("carol");
    expect(target.get("next")).toBe("/cmc-scope-update");
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
  });

  it("[SUA4] the expected account, in any case: Approve is offered", async () => {
    signedIn();
    renderPage({ username: "Alice" });
    await proposalShown();
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect(button("Approve").disabled).toBe(false);
  });

  it("[SUA5] an email hint is not compared with the account", async () => {
    signedIn();
    renderPage({ username: "carol@example.test" });
    await proposalShown();
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect(button("Approve").disabled).toBe(false);
  });

  it("[SUA6] the signed-in account cannot be read: no Approve, sign in again instead", async () => {
    signedIn("https://tok@unreachable.core.test/");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderPage();
    const block = await screen.findByTestId("cmc-switch-account");
    warn.mockRestore();
    expect(block.textContent).toContain("Could not confirm which account is signed in.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("[SUA7] while the account is looked up: Approve / Decline shown but disabled, then enabled", async () => {
    signedIn();
    let resolve: (name: string) => void = () => {};
    lookup.impl = () => new Promise<string>((r) => (resolve = r));
    renderPage();
    await proposalShown();
    expect((await screen.findByTestId("cmc-checking-account")).textContent).toBe("Checking the signed-in account…");
    expect(button("Approve").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(true);
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    fireEvent.click(button("Approve"));
    expect(cmcMock.acceptScopeUpdate).not.toHaveBeenCalled();
    await act(async () => resolve("alice"));
    expect((await screen.findByTestId("cmc-approving-as")).textContent).toContain("alice");
    expect(screen.queryByTestId("cmc-checking-account")).toBeNull();
    expect(button("Approve").disabled).toBe(false);
    expect(button("Decline").disabled).toBe(false);
  });

  it("[SUA8] a lookup that does not answer in time: sign in again, a late name changes nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    signedIn();
    let resolve: (name: string) => void = () => {};
    lookup.impl = () => new Promise<string>((r) => (resolve = r));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderPage();
    await act(async () => {});
    expect(screen.getByTestId("cmc-checking-account")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    warn.mockRestore();
    expect(screen.getByTestId("cmc-switch-account").textContent).toContain("Could not confirm which account is signed in.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    await act(async () => resolve("alice"));
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    expect(screen.getByTestId("cmc-switch-account")).toBeTruthy();
  });

  it("[SUA9] a username= that cannot name an account is not compared nor shown", async () => {
    signedIn();
    const crafted = "call 0800 000 000 to unlock your account";
    renderPage({ username: crafted });
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect(document.body.textContent).not.toContain("0800");
    cleanup();
    renderPage({ username: "a".repeat(61) });
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
  });

  it("[SUA10] Approve answers with the session the page named", async () => {
    signedIn();
    cmcMock.acceptScopeUpdate.mockResolvedValue({ updateAcceptEventId: "evt-1", peerNotified: true });
    renderPage();
    await proposalShown();
    await screen.findByTestId("cmc-approving-as");
    fireEvent.click(button("Approve"));
    await screen.findByText("Scope update approved");
    const [conn, id] = cmcMock.acceptScopeUpdate.mock.calls[0] as [{ apiEndpoint: string }, string];
    expect(conn.apiEndpoint).toBe("https://tok@alice.core.test/");
    expect(id).toBe("req-1");
  });

  it("[SUA11] a request already answered: no account line, no switch, nothing to approve", async () => {
    signedIn();
    request.row = { event: { content: { ...PENDING_REQUEST.event.content, status: "accepted" } } };
    renderPage({ username: "carol" });
    await screen.findByText("You have already answered this request. It was approved.");
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    expect(screen.queryByTestId("cmc-checking-account")).toBeNull();
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect(button("Approve").disabled).toBe(true);
    cleanup();
    renderPage();
    await screen.findByText("You have already answered this request. It was approved.");
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    expect(screen.queryByRole("button", { name: "Not you? Switch account" })).toBeNull();
  });

  it("[SUA12] a request that cannot be read: no account line; another expected account still offers the switch", async () => {
    signedIn();
    request.row = { error: { id: "unknown-resource", message: "Unknown event" } };
    renderPage();
    await screen.findByText(/could not be found on your account/);
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    cleanup();
    renderPage({ username: "carol" });
    const block = await screen.findByTestId("cmc-switch-account");
    expect(block.textContent).toContain("This request is for carol, but you are signed in as alice.");
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
  });
});
