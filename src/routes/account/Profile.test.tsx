// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [PRFP] Profile page: the extension slot renders between the account card
 * and the email card; the language is a choice only when there is more than
 * one option, and choosing writes account.update.
 */

const state = vi.hoisted(() => {
  const api = vi.fn();
  return {
    api,
    // Stable across renders, like the real session's connection.
    connection: { api, service: { info: async () => ({}) } },
    options: [{ value: "en", label: "English" }] as Array<{ value: string; label: string }>,
  };
});
vi.mock("../../lib/session", () => ({
  useSession: () => ({ connection: state.connection, setConnection: vi.fn() }),
}));
vi.mock("../../lib/languages", () => ({
  get LANGUAGE_OPTIONS() {
    return state.options;
  },
}));
vi.mock("../../extensions/ProfileExtensions", () => ({
  default: ({ username }: { username: string }) => <p data-testid="profile-ext">extension for {username}</p>,
}));

import Profile from "./Profile";

const ACCOUNT = { username: "alice", email: "alice@example.com", language: "en" };

beforeEach(() => {
  state.options = [{ value: "en", label: "English" }];
  state.api.mockReset();
  state.api.mockImplementation(async (calls: Array<{ method: string; params: { update?: Record<string, unknown> } }>) =>
    calls.map((c) =>
      c.method === "account.update" ? { account: { ...ACCOUNT, ...c.params.update } } : { account: ACCOUNT },
    ),
  );
});
afterEach(() => cleanup());

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

describe("[PRFP] profile page", () => {
  it("[PRF1] mounts the extension slot between the account card and the email card", async () => {
    renderProfile();
    const ext = await screen.findByTestId("profile-ext");
    expect(ext.textContent).toBe("extension for alice");
    const username = screen.getByText("alice");
    const email = screen.getByText("Email");
    expect(username.compareDocumentPosition(ext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ext.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("[PRF2] with a single language option, shows the language read-only", async () => {
    renderProfile();
    await screen.findByText("alice");
    expect(screen.queryByLabelText("Language")).toBeNull();
    expect(screen.getByText("Language")).toBeTruthy();
  });

  it("[PRF3] with several options, choosing one writes account.update { language }", async () => {
    state.options = [
      { value: "en", label: "English" },
      { value: "fr", label: "French" },
    ];
    renderProfile();
    const select = (await screen.findByLabelText("Language")) as HTMLSelectElement;
    expect(select.value).toBe("en");
    fireEvent.change(select, { target: { value: "fr" } });
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith([
        { method: "account.update", params: { update: { language: "fr" } } },
      ]),
    );
    await waitFor(() => expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe("fr"));
  });
});
