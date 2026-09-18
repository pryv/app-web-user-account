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

const conn = vi.hoisted(() => ({
  accesses: [] as Array<Record<string, unknown>>,
  selfId: "pat-1",
  api: vi.fn(),
  accessInfo: vi.fn(),
}));
vi.mock("../../lib/session", () => ({
  useSession: () => ({ connection: { api: conn.api, accessInfo: conn.accessInfo }, setConnection: vi.fn() }),
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
});
