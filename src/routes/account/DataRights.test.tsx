// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [DRDL] Data rights page: "Delete my account" sends the deletion to the
 * user's home core named by the register, never under the user endpoint.
 */

const state = vi.hoisted(() => ({
  connection: {
    endpoint: "https://alice.example.com/",
    token: "personal-token",
    username: async () => "alice",
    service: { info: async () => ({ register: "https://reg.example.com/" }) },
  },
  setConnection: vi.fn(),
}));
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: state.connection, setConnection: state.setConnection }),
}));

import DataRights from "./DataRights";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  state.setConnection.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "https://reg.example.com/alice/server" && init?.method === "POST") {
      return new Response(JSON.stringify({ server: "https://core-a.example.com/" }), { status: 200 });
    }
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ userDeletion: { username: "alice" } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[DRDL] delete my account", () => {
  it("[DRD1] DELETE goes to the home core's root with the personal token, then the session is cleared", async () => {
    render(
      <MemoryRouter>
        <DataRights />
      </MemoryRouter>,
    );
    const field = await screen.findByLabelText(/username/i);
    await waitFor(() => expect(screen.getByText("alice")).toBeTruthy());
    fireEvent.change(field, { target: { value: "alice" } });
    const button = screen.getByRole("button", { name: /delete/i });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(state.setConnection).toHaveBeenCalledWith(null));
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(del?.[0]).toBe("https://core-a.example.com/users/alice");
    const headers = del?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("personal-token");
  });
});
