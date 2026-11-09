// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [RSSI] The "Back to sign in" links of the reset page keep the page's
 * parameters but never the reset token: before the reset it is still valid,
 * after it it is spent, and neither belongs in the sign-in URL or history.
 */

const service = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
  resolveUserId: async (_service: unknown, username: string) => username,
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import ResetPassword from "./ResetPassword";
import { signInSearch } from "../lib/signInSearch";

const KEPT = {
  backUrl: "https://app.example.test/after?x=1",
  backLabel: "Example app",
  pryvServiceInfoUrl: "https://reg.example.test/service/info",
};

function pageSearch(): string {
  return "?" + new URLSearchParams({ resetToken: "rsSecretToken42", ...KEPT }).toString();
}

function renderReset() {
  render(
    <MemoryRouter initialEntries={["/reset-password" + pageSearch()]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signInLinks(): URL[] {
  return screen.getAllByRole("link")
    .map((a) => new URL(a.getAttribute("href") ?? "", "https://account.example.test"))
    .filter((url) => url.pathname === "/signin");
}

function expectKeptWithoutToken(url: URL) {
  expect(url.searchParams.has("resetToken")).toBe(false);
  expect(url.search).not.toContain("rsSecretToken42");
  for (const [key, value] of Object.entries(KEPT)) expect(url.searchParams.get(key)).toBe(value);
}

describe("[RSSI] reset page sign-in links", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[RSSI1] signInSearch drops resetToken and keeps the rest; nothing left gives an empty string", () => {
    expect(signInSearch("?resetToken=a&backUrl=b")).toBe("?backUrl=b");
    expect(signInSearch("?resetToken=a")).toBe("");
    expect(signInSearch("")).toBe("");
    expect(signInSearch("?backLabel=x")).toBe("?backLabel=x");
  });

  it("[RSSI2] before the reset, the sign-in link keeps the parameters and not the still-valid token", () => {
    renderReset();
    const links = signInLinks();
    expect(links).toHaveLength(1);
    expectKeptWithoutToken(links[0]);
  });

  it("[RSSI3] after the reset, the sign-in link keeps the parameters and not the spent token", async () => {
    service.resetPassword.mockResolvedValue(undefined);
    const { container } = render(
      <MemoryRouter initialEntries={["/reset-password" + pageSearch()]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(container.querySelector("#username")!, { target: { value: "alice" } });
    fireEvent.change(container.querySelector("#newPassword")!, { target: { value: "n3w-passw0rd" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(service.resetPassword).toHaveBeenCalledWith("alice", "n3w-passw0rd", "rsSecretToken42", expect.anything());
    const links = signInLinks();
    expect(links).toHaveLength(1);
    expectKeptWithoutToken(links[0]);
  });
});
