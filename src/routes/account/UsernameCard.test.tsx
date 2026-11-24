// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * [UNCC] Username card: the changes left, the change form (client check,
 * confirmation, refusals), the session moved to the new name's endpoint, and
 * nothing offered while acting for another account or when the platform does
 * not answer the counts.
 */

const state = vi.hoisted(() => {
  const api = vi.fn();
  const apiEndpointFor = vi.fn(async (u: string, t: string) => `https://${t}@core.example.com/${u}/`);
  return {
    api,
    apiEndpointFor,
    setConnection: vi.fn(),
    actingAs: null as null | { username: string; parentUsername: string },
    accessInfo: {} as Record<string, unknown>,
    connection: {
      apiEndpoint: "https://tok123@core.example.com/alice/",
      api,
      accessInfo: async () => state.accessInfo,
      service: { info: async () => ({}), apiEndpointFor },
    },
    counts: { usernameChangesUsed: 0, usernameChangesLimit: 2, usernameChangesRemaining: 2 } as Record<string, unknown>,
    change: null as unknown,
  };
});
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: state.connection, actingAs: state.actingAs, setConnection: state.setConnection }),
}));
vi.mock("../../lib/sessionStore", () => ({
  connectionFor: (apiEndpoint: string | null) => (apiEndpoint ? { apiEndpoint } : null),
  storedServiceInfoUrl: () => "https://reg.example.com/service/info",
}));

import UsernameCard from "./UsernameCard";

beforeEach(() => {
  state.actingAs = null;
  state.accessInfo = { type: "personal" };
  state.counts = { usernameChangesUsed: 0, usernameChangesLimit: 2, usernameChangesRemaining: 2 };
  state.change = { account: { username: "bobby" }, usernameChangesRemaining: 1, warnings: [] };
  state.setConnection.mockReset();
  state.apiEndpointFor.mockClear();
  state.api.mockReset();
  state.api.mockImplementation(async (calls: Array<{ method: string }>) =>
    calls.map((c) => (c.method === "account.usernameChanges" ? state.counts : state.change)),
  );
});
afterEach(() => cleanup());

function renderCard(onChanged = vi.fn()) {
  render(<UsernameCard username="alice" onChanged={onChanged} />);
  return onChanged;
}

async function submit(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: /change/i }));
  fireEvent.change(screen.getByLabelText("New username"), { target: { value: name } });
  fireEvent.submit(screen.getByLabelText("New username").closest("form")!);
}

describe("[UNCC] username card", () => {
  it("[UNC10] shows the username and the changes left, with a Change button", async () => {
    renderCard();
    expect(screen.getByTestId("profile-username").textContent).toBe("alice");
    expect((await screen.findByTestId("username-changes-left")).textContent).toBe("2 username changes left");
    expect(screen.getByRole("button", { name: /change/i })).toBeTruthy();
  });

  it("[UNC11] no change left: says so, no Change button", async () => {
    state.counts = { usernameChangesUsed: 2, usernameChangesLimit: 2, usernameChangesRemaining: 0 };
    renderCard();
    expect((await screen.findByTestId("username-changes-left")).textContent).toBe("No username changes left");
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
  });

  it("[UNC12] a change after confirmation: notice, onChanged, session moved to the new endpoint", async () => {
    const onChanged = renderCard();
    await submit("Bobby ");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("from alice to bobby");
    fireEvent.click(within(dialog).getByRole("button", { name: "Change username" }));
    await screen.findByText("Your username is now bobby. Use it to sign in.");
    expect(state.api).toHaveBeenCalledWith([{ method: "account.changeUsername", params: { newUsername: "bobby" } }]);
    expect(onChanged).toHaveBeenCalledWith("bobby");
    await waitFor(() =>
      expect(state.setConnection).toHaveBeenCalledWith(
        { apiEndpoint: "https://tok123@core.example.com/bobby/" },
        "https://reg.example.com/service/info",
      ),
    );
    expect(state.apiEndpointFor).toHaveBeenCalledWith("bobby", "tok123");
    expect(screen.getByTestId("username-changes-left").textContent).toBe("1 username change left");
  });

  it("[UNC13] cancelling the confirmation changes nothing", async () => {
    renderCard();
    await submit("bobby");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(state.api).not.toHaveBeenCalledWith([{ method: "account.changeUsername", params: { newUsername: "bobby" } }]);
    expect(state.setConnection).not.toHaveBeenCalled();
  });

  it("[UNC14] a name that breaks the rules is refused before any call", async () => {
    renderCard();
    await submit("ab");
    expect(await screen.findByText("This username does not follow the rules below the field.")).toBeTruthy();
    expect(screen.getByText(/5–60 characters/)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(state.api).toHaveBeenCalledTimes(1);
  });

  it("[UNC15] a taken name: the refusal in words, the session unchanged", async () => {
    state.change = { error: { id: "item-already-exists", message: "exists" } };
    renderCard();
    await submit("bobby");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Change username" }));
    expect(await screen.findByText("This username is already taken.")).toBeTruthy();
    expect(state.setConnection).not.toHaveBeenCalled();
  });

  it("[UNC16] steps that did not complete are listed", async () => {
    state.change = {
      account: { username: "bobby" },
      usernameChangesRemaining: 1,
      warnings: [{ step: "webhooks", message: "Webhooks move at the next start." }],
    };
    renderCard();
    await submit("bobby");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Change username" }));
    expect(await screen.findByText("Webhooks move at the next start.")).toBeTruthy();
  });

  it("[UNC17] acting for another account: no counts, no Change button, no call", async () => {
    state.actingAs = { username: "alice", parentUsername: "carol" };
    renderCard();
    expect(screen.getByTestId("profile-username").textContent).toBe("alice");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("username-changes-left")).toBeNull();
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
    expect(state.api).not.toHaveBeenCalled();
  });

  it("[UNC19] a delegate's session (access info): no counts, no Change button, no call", async () => {
    state.accessInfo = { type: "personal", delegation: { isDelegatedAccess: true, controlledUsername: "alice" } };
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("username-changes-left")).toBeNull();
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
    expect(state.api).not.toHaveBeenCalled();
  });

  it("[UNC18] counts not answered (older core, non-personal session): nothing offered", async () => {
    state.counts = { error: { id: "forbidden", message: "personal only" } };
    renderCard();
    await waitFor(() => expect(state.api).toHaveBeenCalled());
    expect(screen.queryByTestId("username-changes-left")).toBeNull();
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull();
  });
});
