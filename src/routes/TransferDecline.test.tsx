// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * [TRDC] `/transfer-decline`: no sign-in, the token leaves the address bar
 * at once, the Decline button is the confirmation, refusals are explained.
 */

const state = vi.hoisted(() => ({
  replies: [] as Array<{ ok: boolean; status: number; body: unknown }>,
  posts: [] as Array<{ url: string; body: Record<string, unknown> }>,
}));

vi.mock("../lib/service", () => ({
  getService: () => ({ apiEndpointFor: async (username: string) => `https://${username}.core.test/` }),
}));

import TransferDecline from "./TransferDecline";

function Probe() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/transfer-decline" element={<TransferDecline />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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
});

describe("[TRDC] /transfer-decline", () => {
  it("[TRD1] the token leaves the address bar; Decline sends it and confirms", async () => {
    state.replies = [{ ok: true, status: 200, body: { declined: true } }];
    renderAt("/transfer-decline?username=carol&token=SECRET");
    expect((await screen.findByTestId("transfer-decline-question")).textContent).toBe(
      "Decline taking over the account carol?",
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/transfer-decline"));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined; the account holder has been told.")).toBeTruthy();
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0].url).toBe("https://carol.core.test/account/auto-deletion/transfer-decline");
    expect(state.posts[0].body).toMatchObject({ token: "SECRET" });
  });

  it("[TRD2] an invalid link is explained in plain words", async () => {
    state.replies = [
      { ok: false, status: 403, body: { error: { id: "auto-deletion-transfer-invalid-link", message: "raw" } } },
    ];
    renderAt("/transfer-decline?username=carol&token=SPENT");
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("This link is not valid, or no longer valid.")).toBeTruthy();
  });

  it("[TRD4] an account already taken over can no longer be declined", async () => {
    state.replies = [
      { ok: false, status: 409, body: { error: { id: "auto-deletion-transfer-claimed", message: "raw" } } },
    ];
    renderAt("/transfer-decline?username=carol&token=T1");
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(
      await screen.findByText("This account was already taken over: the transfer can no longer be declined."),
    ).toBeTruthy();
  });

  it("[TRD3] an incomplete link says so and offers nothing", async () => {
    renderAt("/transfer-decline?username=carol");
    expect(await screen.findByText(/This link is incomplete/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });
});
