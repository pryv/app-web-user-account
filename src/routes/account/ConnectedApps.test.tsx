// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Connected apps and access details on an account in a delegation: the
 * accesses that run the delegation are listed apart, without Revoke, and
 * point to the delegation page; apps granted through a delegation stay
 * ordinary, revocable apps.
 */

const conn = vi.hoisted(() => {
  const c = {
    accesses: [] as Array<Record<string, unknown>>,
    selfId: "pat-1",
    api: vi.fn(),
    accessInfo: vi.fn(),
    // One stable connection object, as the real session provides: a new one
    // per render would re-run every effect keyed on the connection.
    connection: {} as { api: unknown; accessInfo: unknown },
  };
  c.connection = { api: c.api, accessInfo: c.accessInfo };
  return c;
});
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: conn.connection, setConnection: vi.fn() }),
}));
vi.mock("../../lib/sessionPaths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sessionPaths")>()),
  signinPath: () => "/signin",
}));
vi.mock("../../lib/socket", () => ({ subscribeToAccessChanges: () => () => {} }));

import ConnectedApps from "./ConnectedApps";
import AuditAccess from "./AuditAccess";

const ACCESSES = [
  { id: "app-1", name: "diary-app", type: "app", permissions: [{ streamId: "diary", level: "read" }] },
  { id: "child-1", name: "kid-app", type: "app", permissions: [], clientData: { delegation: { kind: "delegated-child", viaAccessId: "pat-1" } } },
  { id: "ctl-1", name: "__deleg-ctl-r1", type: "shared", permissions: [], clientData: { delegation: { kind: "control", relId: "r1" } } },
  { id: "pat-1", name: "delegation:parent@core-a", type: "personal", clientData: { delegation: { kind: "delegate-pat", relId: "r1" } } },
  { id: "inv-1", name: "invite", type: "shared", permissions: [], clientData: { delegation: { kind: "invite-capability", relId: "r2" } } },
  { id: "ntf-1", name: "notify", type: "shared", permissions: [], clientData: { delegation: { kind: "notify", relId: "r1" } } },
];

beforeEach(() => {
  conn.accesses = ACCESSES;
  conn.api.mockReset();
  conn.api.mockImplementation(async (calls: Array<{ method: string }>) =>
    calls.map((c) => (c.method === "accesses.get" ? { accesses: conn.accesses } : c.method === "events.get" ? { events: [] } : { streams: [] })),
  );
  conn.accessInfo.mockReset();
  conn.accessInfo.mockImplementation(async () => ({ id: conn.selfId }));
});
afterEach(() => cleanup());

describe("[CAPD] connected apps: delegation plumbing", () => {
  it("[CAPD1] lists delegation-managed accesses apart, with a link to the delegation page", async () => {
    render(
      <MemoryRouter>
        <ConnectedApps />
      </MemoryRouter>,
    );
    const section = (await screen.findByRole("heading", { name: "Managed by account delegation" })).closest("section")!;
    const managed = within(section);
    for (const name of ["__deleg-ctl-r1", "delegation:parent@core-a", "invite", "notify"]) {
      expect(managed.getByText(name)).toBeTruthy();
    }
    expect(managed.getByText("delegate session", { exact: false })).toBeTruthy();
    expect(managed.getByText("this session")).toBeTruthy();
    expect(managed.getByRole("link", { name: /manage account delegation/i }).getAttribute("href")).toBe("/account/delegation");
    // the ordinary apps, including one granted through a delegation, are not in it
    expect(managed.queryByText("diary-app")).toBeNull();
    expect(managed.queryByText("kid-app")).toBeNull();
    expect(screen.getByText("diary-app")).toBeTruthy();
    expect(screen.getByText("kid-app")).toBeTruthy();
  });

  it("[CAPD2] without delegation accesses there is no managed section", async () => {
    conn.accesses = ACCESSES.slice(0, 2);
    render(
      <MemoryRouter>
        <ConnectedApps />
      </MemoryRouter>,
    );
    await screen.findByText("diary-app");
    expect(screen.queryByText("Managed by account delegation")).toBeNull();
  });

  function details(id: string) {
    render(
      <MemoryRouter initialEntries={["/account/audit-access/" + id]}>
        <Routes>
          <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("[CAPD3] the details of a delegation-managed access offer no Revoke, and point to the delegation page", async () => {
    for (const id of ["ctl-1", "pat-1", "inv-1", "ntf-1"]) {
      details(id);
      await screen.findByText(/managed by account delegation/i);
      expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
      expect(screen.getByRole("link", { name: /manage account delegation/i }).getAttribute("href")).toBe("/account/delegation");
      cleanup();
    }
  });

  it("[CAPD4] an app access, including one granted through a delegation, keeps its Revoke", async () => {
    for (const id of ["app-1", "child-1"]) {
      details(id);
      await screen.findByRole("button", { name: /revoke/i });
      expect(screen.queryByText(/managed by account delegation/i)).toBeNull();
      cleanup();
    }
  });

  it("[CAPD5] the details page settles: no refetch loop", async () => {
    details("app-1");
    await screen.findByRole("button", { name: /revoke/i });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(conn.api.mock.calls.length).toBeLessThan(10);
  });
});

describe("[CAON] connected apps: OAuth apps by name, one entry per app", () => {
  const META = { name: "Agent", host: "client.example", url: "https://client.example/c.json" };
  const OAUTH = [
    { id: "g1:2", name: "oauth-grant:clinic", type: "app", permissions: [], clientData: { oauth: { client: { name: "Clinic app", origin: "operator" } } } },
    { id: "s1", name: "oauth:clinic", type: "app", permissions: [], clientData: { oauth: { dataGrantId: "g1", client: { name: "Clinic app", origin: "operator" } } } },
    { id: "s2", name: "oauth:clinic", type: "app", permissions: [], clientData: { oauth: { dataGrantId: "g1" } } },
    { id: "g2", name: "oauth-grant:url~abc", type: "app", permissions: [], clientData: { oauth: { client: META } } },
    { id: "g3", name: "oauth-grant:legacy", type: "app", permissions: [] },
  ];

  it("[CAON1] names each OAuth app by its stamp, the host beside a metadata-document client's, the client id when unstamped; sessions fold under their grant", async () => {
    conn.accesses = OAUTH;
    render(
      <MemoryRouter>
        <ConnectedApps />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Clinic app")).toBeTruthy();
    expect(screen.getAllByText("Clinic app")).toHaveLength(1);
    expect(screen.getByText("2 active sessions", { exact: false })).toBeTruthy();
    const agent = screen.getByText("Agent").closest("div")!;
    expect(within(agent).getByText("client.example")).toBeTruthy();
    expect(screen.getByText("legacy")).toBeTruthy();
    expect(screen.queryByText("oauth-grant:clinic")).toBeNull();
    expect(screen.queryByText("oauth:clinic")).toBeNull();
    // One Details link per entry, the grant's.
    const hrefs = screen.getAllByRole("link", { name: /details/i }).map((l) => l.getAttribute("href"));
    expect(hrefs).toEqual(["/account/audit-access/g1%3A2", "/account/audit-access/g2", "/account/audit-access/g3"]);
  });

  it("[CAON2] the current session folded under its grant marks the app's entry", async () => {
    conn.accesses = OAUTH;
    conn.selfId = "s1";
    try {
      render(
        <MemoryRouter>
          <ConnectedApps />
        </MemoryRouter>,
      );
      const entry = (await screen.findByText("Clinic app")).closest("div")!;
      expect(await within(entry).findByText("this session")).toBeTruthy();
    } finally {
      conn.selfId = "pat-1";
    }
  });
});

describe("[CAQS] connected apps: links keep the platform query", () => {
  const Q = "?pryvServiceInfoUrl=" + encodeURIComponent("https://core.test/service/info");

  it("[CAQS1] the Details and delegation links carry the current query", async () => {
    render(
      <MemoryRouter initialEntries={["/account/apps" + Q]}>
        <ConnectedApps />
      </MemoryRouter>,
    );
    await screen.findByText("diary-app");
    const detailsHrefs = screen.getAllByRole("link", { name: /details/i }).map((l) => l.getAttribute("href"));
    expect(detailsHrefs).toContain("/account/audit-access/app-1" + Q);
    expect(detailsHrefs.every((h) => h?.endsWith(Q))).toBe(true);
    expect(screen.getByRole("link", { name: /manage account delegation/i }).getAttribute("href")).toBe("/account/delegation" + Q);
  });

  it("[CAQS2] the access details page links back with the current query", async () => {
    render(
      <MemoryRouter initialEntries={["/account/audit-access/ctl-1" + Q]}>
        <Routes>
          <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/managed by account delegation/i);
    expect(screen.getByRole("link", { name: /back to connected apps/i }).getAttribute("href")).toBe("/account/apps" + Q);
    expect(screen.getByRole("link", { name: /manage account delegation/i }).getAttribute("href")).toBe("/account/delegation" + Q);
  });
});
