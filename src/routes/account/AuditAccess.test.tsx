// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * [AXSP] Access details page: the extension slot renders between the access
 * details card and the audit trail card, only once the access is loaded, with
 * the loaded access and whether it is the session's own.
 */

const conn = vi.hoisted(() => {
  const c = {
    accesses: [] as Array<Record<string, unknown>>,
    selfId: "self-1",
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
vi.mock("../../extensions/AccessExtras", () => ({
  default: ({ access, isSelf }: { access: { id: string; name?: string }; isSelf: boolean }) => (
    <p data-testid="access-ext">
      extension for {access.name} ({access.id}) self={String(isSelf)}
    </p>
  ),
}));

import AuditAccess from "./AuditAccess";

const ACCESSES = [
  { id: "app-1", name: "diary-app", type: "app", permissions: [{ streamId: "diary", level: "read" }] },
  { id: "self-1", name: "personal", type: "personal" },
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

function renderPage(accessId: string) {
  return render(
    <MemoryRouter initialEntries={[`/account/audit-access/${accessId}`]}>
      <Routes>
        <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("[AXSP] access details extension slot", () => {
  it("[AXS1] mounts between the access details card and the audit trail card", async () => {
    renderPage("app-1");
    const ext = await screen.findByTestId("access-ext");
    expect(ext.textContent).toBe("extension for diary-app (app-1) self=false");
    const details = screen.getByText("Access details");
    const trail = screen.getByText("Audit trail");
    expect(details.compareDocumentPosition(ext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ext.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The page settles: no refetch loop (a fresh connection per render would cause one).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(conn.api.mock.calls.length).toBeLessThan(10);
  });

  it("[AXS2] tells the slot when the access is the session's own", async () => {
    renderPage("self-1");
    await waitFor(() =>
      expect(screen.getByTestId("access-ext").textContent).toBe("extension for personal (self-1) self=true"),
    );
  });

  it("[AXS4] dates read with the month written out, never all-numeric", async () => {
    const oct5 = Date.UTC(2026, 9, 5, 12) / 1000;
    conn.accesses = [{ ...ACCESSES[0], created: oct5 }, ACCESSES[1]];
    renderPage("app-1");
    await screen.findByTestId("access-ext");
    const created = screen.getByText(/Oct 5, 2026/);
    expect(created.textContent).not.toMatch(/\b10\/5\/2026\b/);
  });

  it("[AXS5] another connection (the pages now act for another account): the previous load's outcome goes", async () => {
    conn.accesses = [];
    const view = renderPage("app-1");
    await screen.findByText(/This access is not listed anymore/);
    // The session switches to an account that holds the access.
    conn.accesses = ACCESSES;
    conn.connection = { api: conn.api, accessInfo: conn.accessInfo };
    view.rerender(
      <MemoryRouter initialEntries={["/account/audit-access/app-1"]}>
        <Routes>
          <Route path="/account/audit-access/:accessId" element={<AuditAccess />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("access-ext");
    expect(screen.queryByText(/This access is not listed anymore/)).toBeNull();
  });

  it("[AXS3] does not mount while the access is not loaded, nor when it is not listed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    conn.accesses = [];
    conn.api.mockImplementation(async (calls: Array<{ method: string }>) => {
      if (calls.some((c) => c.method === "accesses.get")) await gate;
      return calls.map((c) => (c.method === "accesses.get" ? { accesses: conn.accesses } : c.method === "events.get" ? { events: [] } : { streams: [] }));
    });
    renderPage("gone-1");
    await screen.findByText("Audit trail");
    expect(screen.queryByTestId("access-ext")).toBeNull();
    release();
    await screen.findByText(/This access is not listed anymore/);
    expect(screen.queryByTestId("access-ext")).toBeNull();
  });
});
