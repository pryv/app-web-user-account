// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * [CAPV] Connected apps and the access page show an OAuth app's current
 * validation beside the level stamped at consent, asked once at the core of
 * the session (`POST /oauth2/clients/validation`), with a notice when it lost
 * validation or is no longer served; a core without the route (404) shows
 * nothing new and no error.
 */

const conn = vi.hoisted(() => {
  const c = {
    api: vi.fn(),
    accessInfo: vi.fn(async () => ({ id: "pat-1" })),
    username: vi.fn(async () => "alice"),
    connection: {} as Record<string, unknown>,
  };
  c.connection = { api: c.api, accessInfo: c.accessInfo, username: c.username, apiEndpoint: "https://tok@core.example.com/alice/" };
  return c;
});
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: conn.connection, setConnection: vi.fn() }),
}));
vi.mock("../../lib/socket", () => ({ subscribeToAccessChanges: () => () => {} }));

import ConnectedApps from "./ConnectedApps";
import AuditAccess from "./AuditAccess";

const ACCESSES = [
  {
    id: "g-1",
    name: "oauth-grant:clinic",
    type: "app",
    permissions: [],
    clientData: { oauth: { grantOf: "clinic", client: { name: "Clinic", origin: "developer", validation: { level: "appValidated" } } } },
  },
  { id: "s-1", name: "oauth:clinic", type: "app", permissions: [], clientData: { oauth: { dataGrantId: "g-1" } } },
  {
    id: "g-2",
    name: "oauth-grant:diary",
    type: "app",
    permissions: [],
    clientData: { oauth: { grantOf: "diary", client: { name: "Diary", origin: "operator", validation: { level: "appValidated" } } } },
  },
  { id: "app-1", name: "plain-app", type: "app", permissions: [] },
  // Named after held clients, but not stamped by the server as minted for them.
  { id: "spoof-1", name: "oauth-grant:diary", type: "app", permissions: [] },
  { id: "spoof-2", name: "oauth:clinic", type: "shared", permissions: [], clientData: { oauth: { dataGrantId: "g-other" } } },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  conn.api.mockReset();
  conn.api.mockImplementation(async (calls: Array<{ method: string }>) =>
    calls.map((c) => (c.method === "accesses.get" ? { accesses: ACCESSES } : c.method === "events.get" ? { events: [] } : {})),
  );
  fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ clients: { clinic: { level: "nonValidated", served: true }, diary: { level: "appValidated", served: false } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function cardOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: ".accessName" }).closest("[data-testid=access-card]") as HTMLElement;
}

describe("[CAPV] current validation of the connected apps", () => {
  it("[CAPV1] Connected apps: one request for the OAuth apps, both levels and the notices", async () => {
    render(
      <MemoryRouter>
        <ConnectedApps />
      </MemoryRouter>,
    );
    await screen.findAllByTestId("current-validation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://core.example.com/oauth2/clients/validation");
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice", userToken: "tok", clientIds: ["clinic", "diary"] });
    const clinic = within(cardOf("Clinic"));
    expect(clinic.getByTestId("current-validation").textContent).toContain("Validation at consent: App Validated");
    expect(clinic.getByTestId("current-validation-level").textContent).toBe("Current validation: Non-Validated");
    expect(clinic.getByTestId("current-validation-notice").textContent).toBe("This application lost validation since you allowed it.");
    expect(within(cardOf("Diary")).getByTestId("current-validation-notice").textContent).toContain("The platform no longer serves");
    expect(within(cardOf("plain-app")).queryByTestId("current-validation")).toBeNull();
    // Accesses only named after a held client: no line (the request named the stamped ones only).
    expect(within(cardOf("diary")).queryByTestId("current-validation")).toBeNull();
    expect(within(cardOf("clinic")).queryByTestId("current-validation")).toBeNull();
  });

  it("[CAPV4] the access page of an access only named after a held client: no line, nothing asked", async () => {
    render(
      <MemoryRouter initialEntries={["/account/audit-access/spoof-2"]}>
        <Routes>
          <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("spoof-2");
    expect(screen.queryByTestId("current-validation")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[CAPV2] a core without the route: nothing new, no error", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 404 }));
    render(
      <MemoryRouter>
        <ConnectedApps />
      </MemoryRouter>,
    );
    await screen.findByText("Clinic", { selector: ".accessName" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("current-validation")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[CAPV3] the access page: the grant's current validation beside its stamp", async () => {
    render(
      <MemoryRouter initialEntries={["/account/audit-access/g-1"]}>
        <Routes>
          <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
        </Routes>
      </MemoryRouter>,
    );
    const line = await screen.findByTestId("current-validation");
    expect(line.textContent).toContain("Validation at consent: App Validated");
    expect(within(line).getByTestId("current-validation-level").textContent).toBe("Current validation: Non-Validated");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).clientIds).toEqual(["clinic"]);
  });
});
