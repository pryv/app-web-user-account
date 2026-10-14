// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * [AXSP] Access details page: the extension slot renders between the access
 * details card and the audit trail card, only once the access is loaded, with
 * the loaded access and whether it is the session's own.
 */

const conn = vi.hoisted(() => {
  const c = {
    accesses: [] as Array<Record<string, unknown>>,
    // Deletion records, answered only when the page asks for them (`includeDeletions`).
    deletions: [] as Array<Record<string, unknown>>,
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
  default: ({ access, isSelf }: { access: { id: string; name?: string; deleted?: number }; isSelf: boolean }) => (
    <p data-testid="access-ext" data-deleted={access.deleted ?? ""}>
      extension for {access.name} ({access.id}) self={String(isSelf)}
    </p>
  ),
}));

import AuditAccess from "./AuditAccess";

const ACCESSES = [
  { id: "app-1", name: "diary-app", type: "app", permissions: [{ streamId: "diary", level: "read" }] },
  { id: "self-1", name: "personal", type: "personal" },
];

type Call = { method: string; params?: { includeDeletions?: boolean; streams?: unknown } };

/** `accesses.get` as the platform answers it: deletion records only on request. */
function accessesGet(c: Call) {
  return c.params?.includeDeletions
    ? { accesses: conn.accesses, accessDeletions: conn.deletions }
    : { accesses: conn.accesses };
}

beforeEach(() => {
  conn.accesses = ACCESSES;
  conn.deletions = [];
  conn.selfId = "self-1";
  conn.api.mockReset();
  conn.api.mockImplementation(async (calls: Call[]) =>
    calls.map((c) => (c.method === "accesses.get" ? accessesGet(c) : c.method === "events.get" ? { events: [] } : { streams: [] })),
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

  it("[AXS6] client data shows a consent grant's endpoints without their token", async () => {
    conn.accesses = [
      {
        ...ACCESSES[0],
        clientData: {
          cmc: {
            role: "counterparty",
            counterparty: { username: "alice", host: "core.example.com", apiEndpoint: "https://c3x9tok3n@core.example.com/alice/" },
            backChannelApiEndpoint: "https://bk7tok3n@core.example.com/alice/",
          },
        },
      },
      ACCESSES[1],
    ];
    renderPage("app-1");
    const block = await screen.findByText(/"counterparty"/);
    expect(block.textContent).toContain("https://***@core.example.com/alice/");
    expect(document.body.textContent).not.toContain("c3x9tok3n");
    expect(document.body.textContent).not.toContain("bk7tok3n");
    expect(block.textContent).toContain('"username": "alice"');
  });

  it("[AXS7] audit and data rows show endpoints without their token", async () => {
    conn.api.mockImplementation(async (calls: Array<{ method: string; params?: { streams?: unknown } }>) =>
      calls.map((c) => {
        if (c.method === "accesses.get") return { accesses: conn.accesses };
        if (c.method === "events.get" && c.params?.streams != null) {
          return {
            events: [
              { id: "a1", time: 1789000000, type: "audit-log/pryv-api", streamIds: [], content: { action: "events.get", query: { capabilityUrl: "https://q5tok3n@core.example.com/bob/" } } },
              { id: "a2", time: 1789000001, type: "audit-log/pryv-api-error", streamIds: [], content: { id: "unreachable", message: "could not reach https://m6tok3n@core.example.com/bob/" } },
            ],
          };
        }
        if (c.method === "events.get") {
          return { events: [{ id: "d1", time: 1789000000, type: "note/txt", createdBy: "app-1", content: "https://d8tok3n@core.example.com/bob/" }] };
        }
        return { streams: [] };
      }),
    );
    renderPage("app-1");
    await screen.findByText(/could not reach https:\/\/\*\*\*@core\.example\.com\/bob\//);
    await screen.findByText("https://***@core.example.com/bob/");
    await screen.findByText('{"capabilityUrl":"https://***@core.example.com/bob/"}');
    const text = document.body.innerHTML;
    for (const token of ["q5tok3n", "m6tok3n", "d8tok3n"]) expect(text).not.toContain(token);
  });

  it("[AXS8] an error the page shows names no token", async () => {
    conn.api.mockImplementation(async (calls: Array<{ method: string }>) =>
      calls.map((c) =>
        c.method === "accesses.get"
          ? { error: { id: "forbidden", message: "denied for https://e9tok3n@core.example.com/bob/" } }
          : c.method === "events.get"
            ? { events: [] }
            : { streams: [] },
      ),
    );
    renderPage("app-1");
    await screen.findByText("denied for https://***@core.example.com/bob/");
    expect(document.body.innerHTML).not.toContain("e9tok3n");
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

/**
 * [ATTR] Who acted, readable: a removed access shows by name, "created by" /
 * "modified by" name the access they refer to, and a caller label shows on the
 * audit entries that carry one.
 */
describe("[ATTR] attribution on the access details page", () => {
  const oct5 = Date.UTC(2026, 9, 5, 12) / 1000;
  const GRANT = { id: "grant-1:2", name: "clinic-group", type: "app" };
  const MEMBER = {
    id: "member-1",
    name: "dr-smith",
    type: "shared",
    createdBy: "grant-1:2 nurse-desk",
    modifiedBy: "self-1",
    deleted: oct5,
  };

  it("[ATT1] asks for the deletion records, and shows a removed access by name with its removal date", async () => {
    conn.deletions = [MEMBER];
    renderPage("member-1");
    await screen.findByText("dr-smith");
    expect(conn.api.mock.calls.some(([calls]) =>
      (calls as Call[]).some((c) => c.method === "accesses.get" && c.params?.includeDeletions === true),
    )).toBe(true);
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.getByText(/This access was removed on Oct 5, 2026/)).toBeTruthy();
    expect(screen.queryByText(/This access is not listed anymore/)).toBeNull();
    // Nothing left to revoke.
    expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
    // The extension slot mounts for it too, told when it was removed.
    const ext = screen.getByTestId("access-ext");
    expect(ext.textContent).toBe("extension for dr-smith (member-1) self=false");
    expect(ext.getAttribute("data-deleted")).toBe(String(oct5));
  });

  it("[ATT2] an access in neither list is the only one shown as missing", async () => {
    conn.deletions = [MEMBER];
    renderPage("unknown-1");
    await screen.findByText(/This access is not listed anymore/);
    expect(screen.queryByText(/This access was removed/)).toBeNull();
  });

  it("[ATT3] created by / modified by read 'via <name>', linking to that access, version and caller label stripped", async () => {
    conn.accesses = [GRANT, ACCESSES[1]];
    conn.deletions = [MEMBER];
    renderPage("member-1");
    const via = await screen.findByRole("link", { name: "clinic-group" });
    expect(via.getAttribute("href")).toBe("/account/audit-access/grant-1%3A2");
    expect(via.closest("dd")?.textContent).toContain("via clinic-group");
    expect(via.closest("dd")?.textContent).toContain("Caller label (not verified): nurse-desk");
    const modifiedBy = screen.getByRole("link", { name: "personal" });
    expect(modifiedBy.getAttribute("href")).toBe("/account/audit-access/self-1");
    // Without a caller label, no label line.
    expect(modifiedBy.closest("dd")?.textContent).toBe("via personal");
    // The raw references are no longer the text shown.
    expect(screen.queryByText("grant-1:2 nurse-desk")).toBeNull();
  });

  it("[ATT4] a removed parent is marked; an unknown one stays the raw reference", async () => {
    conn.accesses = [{ ...ACCESSES[0], createdBy: "gone-grant:3 desk", modifiedBy: "never-seen" }, ACCESSES[1]];
    conn.deletions = [{ id: "gone-grant:3", name: "old-group", deleted: oct5 }];
    renderPage("app-1");
    const via = await screen.findByRole("link", { name: "old-group" });
    expect(via.closest("dd")?.textContent).toContain("via old-group (removed)");
    expect(screen.getByText("never-seen")).toBeTruthy();
  });

  it("[ATT9] a caller label is shown without the token of a URL it carries, tooltip and raw reference included", async () => {
    conn.accesses = [
      { ...ACCESSES[0], createdBy: "self-1 https://t0k3n@h.example/", modifiedBy: "never-seen https://r4wt0k@h.example/" },
      ACCESSES[1],
    ];
    renderPage("app-1");
    const via = await screen.findByRole("link", { name: "personal" });
    expect(via.getAttribute("title")).toBe("self-1 https://***@h.example/");
    expect(screen.getByText("never-seen https://***@h.example/")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("t0k3n");
    expect(document.body.innerHTML).not.toContain("r4wt0k");
  });

  it("[ATT5] following 'via' opens that access's page afresh: the previous page's filters do not carry over", async () => {
    conn.accesses = [GRANT, ACCESSES[1]];
    conn.deletions = [MEMBER];
    renderPage("member-1");
    const via = await screen.findByRole("link", { name: "clinic-group" });
    // Filter the removed access's trail to its errors.
    const errorsOnly = screen.getByRole("checkbox", { name: "Errors only" });
    fireEvent.click(errorsOnly);
    fireEvent.submit(errorsOnly.closest("form")!);
    await waitFor(() =>
      expect(conn.api.mock.calls.some(([calls]) =>
        (calls as Array<{ method: string; params?: { types?: unknown } }>).some((c) => c.method === "events.get" && c.params?.types != null),
      )).toBe(true),
    );
    fireEvent.click(via);
    await waitFor(() => expect(screen.queryByText("dr-smith")).toBeNull());
    await screen.findByText("clinic-group");
    expect(screen.queryByText(/This access was removed/)).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Errors only" }) as HTMLInputElement).checked).toBe(false);
    // The parent's trail is read unfiltered.
    await waitFor(() => {
      const trailReads = conn.api.mock.calls
        .flatMap(([calls]) => calls as Array<{ method: string; params?: { streams?: unknown; types?: unknown } }>)
        .filter((c) => c.method === "events.get" && JSON.stringify(c.params?.streams ?? "").includes("access-grant-1"));
      expect(trailReads.length).toBeGreaterThan(0);
      expect(trailReads.every((c) => c.params?.types == null)).toBe(true);
    });
  });

  it("[ATT8] the session's own access is recognised under another version of its id", async () => {
    conn.selfId = "self-1:2";
    renderPage("self-1");
    await screen.findByText("this session");
    await waitFor(() =>
      expect(screen.getByTestId("access-ext").textContent).toBe("extension for personal (self-1) self=true"),
    );
  });

  it("[ATT7] an access updated once: its trail lists the entries from before and after the update", async () => {
    // As the platform files them: every entry under `access-<base>`, those
    // made after the update also under `access-<base>:2`.
    const AUDIT = [
      { id: "before", time: 1789000000, type: "audit-log/pryv-api", streamIds: [":_audit:access-upd-1", ":_audit:action-events.get"], content: { source: { ip: "10.0.0.1" } } },
      { id: "after", time: 1789000100, type: "audit-log/pryv-api", streamIds: [":_audit:access-upd-1", ":_audit:access-upd-1:2", ":_audit:action-events.create"], content: { source: { ip: "10.0.0.2" } } },
    ];
    conn.accesses = [{ id: "upd-1:2", name: "updated-app", type: "app" }, ACCESSES[1]];
    conn.api.mockImplementation(async (calls: Call[]) =>
      calls.map((c) => {
        if (c.method === "accesses.get") return accessesGet(c);
        if (c.method === "events.get" && Array.isArray(c.params?.streams)) {
          const wanted = c.params?.streams as string[];
          return { events: AUDIT.filter((e) => e.streamIds.some((s) => wanted.includes(s))).reverse() };
        }
        if (c.method === "events.get") return { events: [] };
        return { streams: [] };
      }),
    );
    // The page is opened with the access's current id, as connected apps links it.
    renderPage(encodeURIComponent("upd-1:2"));
    await screen.findByText("updated-app");
    await screen.findByText("events.get");
    expect(screen.getByText("events.create")).toBeTruthy();
    expect(screen.getByText("10.0.0.1")).toBeTruthy();
    expect(screen.getByText("10.0.0.2")).toBeTruthy();
  });

  it("[ATT6] an audit entry shows the caller label it carries, as not verified", async () => {
    conn.api.mockImplementation(async (calls: Call[]) =>
      calls.map((c) => {
        if (c.method === "accesses.get") return accessesGet(c);
        if (c.method === "events.get" && c.params?.streams != null) {
          return {
            events: [
              { id: "a1", time: 1789000000, type: "audit-log/pryv-api", streamIds: [], content: { action: "events.get", source: { ip: "10.0.0.1" }, callerId: "nurse-desk" } },
              { id: "a2", time: 1789000001, type: "audit-log/pryv-api", streamIds: [], content: { action: "events.create", source: { ip: "10.0.0.2" } } },
            ],
          };
        }
        if (c.method === "events.get") return { events: [] };
        return { streams: [] };
      }),
    );
    renderPage("app-1");
    const label = await screen.findByText("Caller label (not verified): nurse-desk");
    expect(label.getAttribute("title")).toMatch(/not verify/);
    expect(label.closest("td")?.textContent).toContain("10.0.0.1");
    expect(screen.getAllByText(/Caller label/)).toHaveLength(1);
  });
});
