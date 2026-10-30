// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CLAIM_STORAGE_KEY } from "../lib/accountTransfer";

/**
 * [TRCL] `/transfer-claim`: the link's owner and token leave the address bar
 * for the tab's storage at once, a signed-out visitor is sent to sign in (or
 * register) without them and comes back, a signed-in one accepts with their
 * own account through the claim sequence, and refusals are explained.
 */

const state = vi.hoisted(() => ({
  connection: null as null | Record<string, unknown>,
  actingAs: null as null | { username: string; parentUsername: string },
  acceptAttach: vi.fn(),
  replies: [] as Array<{ ok: boolean; status: number; body: unknown }>,
  posts: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));

vi.mock("../lib/useSession", () => ({
  useSession: () => ({
    connection: state.connection,
    setConnection: vi.fn(),
    actingAs: state.actingAs,
    backToParent: vi.fn(),
  }),
}));
vi.mock("../lib/service", () => ({
  getService: () => ({ apiEndpointFor: async (username: string) => `https://${username}.core.test/` }),
}));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return {
    ...actual,
    Delegation: { fromConnection: () => ({ acceptAttach: state.acceptAttach }) },
  };
});

import TransferClaim from "./TransferClaim";
import { useApprovingAccount } from "../lib/useApprovingAccount";

const ALICE = {
  apiEndpoint: "https://tok@alice.core.test/",
  endpoint: "https://alice.core.test/",
  username: async () => "alice",
};

function Probe() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/transfer-claim" element={<TransferClaim />} />
        <Route path="*" element={null} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent ?? "";

beforeEach(() => {
  state.connection = null;
  state.actingAs = null;
  state.acceptAttach = vi.fn().mockResolvedValue({ relId: "r1", status: "active" });
  state.replies = [];
  state.posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      state.posts.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      const r = state.replies.shift() ?? { ok: true, status: 200, body: {} };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("[TRCL] /transfer-claim", () => {
  it("[TRC1] signed out: the link leaves the address bar, sign-in and register come back without it", async () => {
    renderAt("/transfer-claim?username=carol&token=SECRET&pryvServiceInfoUrl=https%3A%2F%2Freg.test%2Fservice%2Finfo");
    expect((await screen.findByTestId("transfer-claim-intro")).textContent).toBe(
      "You were invited to take over the management of the account carol.",
    );
    await waitFor(() => expect(where()).toBe("/transfer-claim?pryvServiceInfoUrl=https%3A%2F%2Freg.test%2Fservice%2Finfo"));
    expect(JSON.parse(sessionStorage.getItem(CLAIM_STORAGE_KEY) ?? "null")).toEqual({ owner: "carol", token: "SECRET" });

    const signIn = screen.getByRole("link", { name: "Sign in to accept" }).getAttribute("href") ?? "";
    const register = screen.getByRole("link", { name: "Create an account" }).getAttribute("href") ?? "";
    for (const href of [signIn, register]) {
      expect(href).not.toContain("SECRET");
      expect(href).not.toContain("username=");
      expect(new URLSearchParams(href.split("?")[1]).get("next")).toBe("/transfer-claim");
      expect(href).toContain("pryvServiceInfoUrl=");
    }
    expect(signIn.startsWith("/signin?")).toBe(true);
    expect(register.startsWith("/register?")).toBe(true);
  });

  it("[TRC2] back after sign-in: the stored link is used; accept runs the claim sequence", async () => {
    sessionStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify({ owner: "carol", token: "SECRET" }));
    state.connection = ALICE;
    state.replies = [
      { ok: true, status: 200, body: { transfer: { status: "invited", username: "carol" } } },
      { ok: true, status: 200, body: { transfer: { status: "completed", username: "carol" } } },
    ];
    renderAt("/transfer-claim?pryvServiceInfoUrl=https%3A%2F%2Freg.test%2Fservice%2Finfo");
    fireEvent.click(await screen.findByRole("button", { name: "Accept as alice" }));
    expect(await screen.findByText("You now manage the account carol. Open it from Accounts I manage.")).toBeTruthy();
    expect(state.posts.map((p) => p.url)).toEqual([
      "https://carol.core.test/account/auto-deletion/transfer-claim",
      "https://carol.core.test/account/auto-deletion/transfer-claim",
    ]);
    expect(state.posts[0].body).toMatchObject({ token: "SECRET", claimant: "alice" });
    expect(typeof state.posts[0].body.appId).toBe("string");
    expect(state.acceptAttach).toHaveBeenCalledWith("carol");
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).toBeNull();
    const link = screen.getByRole("link", { name: "Go to Accounts I manage" }).getAttribute("href") ?? "";
    expect(link.startsWith("/account/delegation?")).toBe(true);
    expect(link).toContain("pryvServiceInfoUrl=https%3A%2F%2Freg.test%2Fservice%2Finfo");
  });

  it("[TRC3] a definitive refusal is explained, the accept goes, the stored link is dropped", async () => {
    state.connection = ALICE;
    state.replies = [
      { ok: false, status: 409, body: { error: { id: "auto-deletion-transfer-claimed", message: "raw" } } },
    ];
    renderAt("/transfer-claim?username=carol&token=SECRET");
    fireEvent.click(await screen.findByRole("button", { name: "Accept as alice" }));
    expect(await screen.findByText("Another account has already taken over this account.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept as alice" })).toBeNull();
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).toBeNull();
    expect(state.acceptAttach).not.toHaveBeenCalled();
  });

  it("[TRC4] a passing refusal keeps the link and the accept for another try", async () => {
    state.connection = ALICE;
    state.replies = [{ ok: false, status: 429, body: { error: { id: "too-many-attempts", message: "raw" } } }];
    renderAt("/transfer-claim?username=carol&token=SECRET");
    fireEvent.click(await screen.findByRole("button", { name: "Accept as alice" }));
    expect(await screen.findByText(/Wait a moment/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept as alice" })).toBeTruthy();
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).not.toBeNull();
  });

  it("[TRC5] acting for another account: no accept, a way back", async () => {
    state.connection = ALICE;
    state.actingAs = { username: "kid", parentUsername: "alice" };
    renderAt("/transfer-claim?username=carol&token=SECRET");
    expect(await screen.findByText("You are acting for the account kid. Go back to your own account to accept.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept as/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to alice" })).toBeTruthy();
  });

  it("[TRC7] the link's owner is never read as the account expected to accept", async () => {
    state.connection = ALICE;
    // The hook alone, with the owner's `username=` still in the address: the
    // claim page's option ignores it; the cmc default would ask to switch.
    function Who({ expect: expectUsername }: { expect: boolean }) {
      const who = useApprovingAccount("/transfer-claim", { expectUsername });
      return (
        <div data-testid={`who-${expectUsername}`}>
          {who.account.status}:{String(who.wrongAccount)}:{String(who.blocked)}:{String(who.mayAnswer)}
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/transfer-claim?username=carol&token=SECRET"]}>
        <Who expect={false} />
        <Who expect={true} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("who-false").textContent).toBe("known:false:false:true"));
    expect(screen.getByTestId("who-true").textContent).toBe("known:true:true:false");
    cleanup();

    // The page: carol's link, alice signed in: Accept, never the Switch-account block.
    renderAt("/transfer-claim?username=carol&token=SECRET");
    expect(await screen.findByRole("button", { name: "Accept as alice" })).toBeTruthy();
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
  });

  it("[TRC8] the second claim still invited: the acceptance is recorded, the transfer completes shortly", async () => {
    state.connection = ALICE;
    state.replies = [
      { ok: true, status: 200, body: { transfer: { status: "invited", username: "carol" } } },
      { ok: true, status: 200, body: { transfer: { status: "invited", username: "carol" } } },
    ];
    renderAt("/transfer-claim?username=carol&token=SECRET");
    fireEvent.click(await screen.findByRole("button", { name: "Accept as alice" }));
    expect(await screen.findByText(/Your acceptance is recorded\. The transfer of the account carol completes shortly/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Accepted" })).toBeTruthy();
    expect(screen.queryByText(/try again/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Go to Accounts I manage" })).toBeTruthy();
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).toBeNull();
  });

  it("[TRC9] a failure that never reached the platform says so, and keeps the link", async () => {
    state.connection = ALICE;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderAt("/transfer-claim?username=carol&token=SECRET");
    fireEvent.click(await screen.findByRole("button", { name: "Accept as alice" }));
    expect(await screen.findByText("Could not reach the platform. Check your connection, then try again.")).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).not.toBeNull();
  });

  it("[TRC6] no link in the address bar nor in the tab: says so", async () => {
    renderAt("/transfer-claim");
    expect(await screen.findByText(/This link is incomplete or was already used/)).toBeTruthy();
  });
});
