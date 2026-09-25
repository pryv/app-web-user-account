// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [PRFL] Profile page and the UI language: the account's `language` is
 * adopted once the account is read, and choosing a language switches the UI
 * after the account is updated.
 */

const state = vi.hoisted(() => {
  const api = vi.fn();
  return {
    api,
    connection: { api, service: { info: async () => ({}) } },
    sync: vi.fn(),
  };
});
vi.mock("../../lib/session", () => ({
  useSession: () => ({ connection: state.connection, setConnection: vi.fn() }),
}));
vi.mock("../../lib/languages", () => ({
  LANGUAGE_OPTIONS: [
    { value: "en", label: "English" },
    { value: "fr", label: "Français" },
  ],
}));
vi.mock("../../extensions/ProfileExtensions", () => ({ default: () => null }));
vi.mock("../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n")>();
  return { ...actual, syncLocaleFromAccount: state.sync };
});

import i18n from "../../i18n";
import Profile from "./Profile";

const ACCOUNT = { username: "alice", email: "alice@example.com", language: "fr" };

beforeEach(() => {
  state.sync.mockReset();
  state.api.mockReset();
  state.api.mockImplementation(async (calls: Array<{ method: string; params: { update?: Record<string, unknown> } }>) =>
    calls.map((c) =>
      c.method === "account.update" ? { account: { ...ACCOUNT, ...c.params.update } } : { account: ACCOUNT },
    ),
  );
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

describe("[PRFL] profile page and the UI language", () => {
  it("[PRFL1] adopts the account's language once the account is read", async () => {
    renderProfile();
    await screen.findByText("alice");
    expect(state.sync).toHaveBeenCalledWith("fr");
  });

  it("[PRFL2] choosing a language saves it, then switches the UI language", async () => {
    const change = vi.spyOn(i18n, "changeLanguage");
    renderProfile();
    const select = (await screen.findByLabelText("Language")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "en" } });
    await waitFor(() => expect(change).toHaveBeenCalledWith("en"));
    expect(state.api).toHaveBeenCalledWith([
      { method: "account.update", params: { update: { language: "en" } } },
    ]);
    const updateOrder = state.api.mock.invocationCallOrder[state.api.mock.calls.length - 1];
    expect(updateOrder).toBeLessThan(change.mock.invocationCallOrder[0]);
  });
});
