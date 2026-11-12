// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";

/**
 * [TRLP] The Audit trail tab: filters read from the URL, Apply rewrites the
 * URL (replace) keeping the hand-off parameters, `as` read once and dropped,
 * the Access column hidden when the view is one access, a revoked access's
 * rows listed under its deletion record's name, a notice when `app` matches
 * no access (and no request), endpoints and caller labels shown masked.
 */

type Call = { method: string; params: Record<string, unknown> };

const conn = vi.hoisted(() => {
  const c = {
    accesses: [] as Array<Record<string, unknown>>,
    deletions: [] as Array<Record<string, unknown>>,
    actions: [] as string[],
    events: [] as Array<Record<string, unknown>>,
    api: vi.fn(),
    accessInfo: vi.fn(),
    connection: {} as { api: unknown; accessInfo: unknown },
  };
  c.connection = { api: c.api, accessInfo: c.accessInfo };
  return c;
});
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: conn.connection, setConnection: vi.fn() }),
}));

import AuditTrail from "./AuditTrail";

const ACCESSES = [
  { id: "g1:2", name: "oauth-grant:clinic", type: "app", clientData: { oauth: { client: { name: "Clinic app", origin: "operator" } } } },
  { id: "s1", name: "oauth:clinic", type: "app", clientData: { oauth: { dataGrantId: "g1" } } },
  { id: "app-1", name: "diary-app", type: "app" },
  { id: "self-1", name: "account-app", type: "personal" },
];
const ACTIONS = ["events.get", "events.create", "streams.get", "auth.login", "callBatch"];
const EVENTS = [
  {
    id: "e1",
    time: 1789000100,
    type: "audit-log/pryv-api",
    streamIds: [":_audit:access-app-1", ":_audit:action-events.get"],
    content: { source: { ip: "10.0.0.1" }, callerId: "nurse-desk", query: { capabilityUrl: "https://q5tok3n@core.example.com/bob/" } },
  },
  {
    id: "e2",
    time: 1789000000,
    type: "audit-log/pryv-api-error",
    streamIds: [":_audit:access-g1", ":_audit:access-g1:2", ":_audit:action-events.create"],
    content: { source: { ip: "10.0.0.2" }, id: "unreachable", message: "could not reach https://m6tok3n@core.example.com/bob/" },
  },
];

beforeEach(() => {
  conn.accesses = ACCESSES;
  conn.deletions = [];
  conn.actions = ACTIONS;
  conn.events = EVENTS;
  conn.api.mockReset();
  conn.api.mockImplementation(async (calls: Call[]) =>
    calls.map((c) => {
      if (c.method === "accesses.get") return { accesses: conn.accesses, accessDeletions: conn.deletions };
      if (c.method === "streams.get") return { streams: conn.actions.map((a) => ({ id: ":_audit:action-" + a })) };
      if (c.method === "events.get") return { events: conn.events };
      return {};
    }),
  );
  conn.accessInfo.mockReset();
});
afterEach(() => cleanup());

function Where() {
  const { search } = useLocation();
  const type = useNavigationType();
  return <p data-testid="where" data-nav={type}>{search}</p>;
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={["/account/audit" + search]}>
      <Routes>
        <Route
          path="/account/audit"
          element={
            <>
              <AuditTrail />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function trailCalls(): Array<Record<string, unknown>> {
  return conn.api.mock.calls
    .flatMap(([calls]) => calls as Call[])
    .filter((c) => c.method === "events.get")
    .map((c) => c.params);
}

describe("[TRLP] audit trail page", () => {
  it("[TRP1] filters come from the URL: app resolved to the grant and its sessions, kind as class blocks, from as a local date", async () => {
    renderAt("?app=clinic&kind=write&from=2026-10-01&backUrl=https%3A%2F%2Fapp.test");
    await waitFor(() => expect(trailCalls()).toHaveLength(1));
    const params = trailCalls()[0];
    expect(params.streams).toEqual([
      { any: [":_audit:action-events.create"], all: [":_audit:access-g1"] },
      { any: [":_audit:action-events.create"], all: [":_audit:access-s1"] },
    ]);
    expect(params.fromTime).toBe(new Date(2026, 9, 1).getTime() / 1000);
    expect(params).not.toHaveProperty("toTime");
    const form = screen.getByRole("form", { name: "Audit trail" });
    expect((within(form).getByLabelText("Kind") as HTMLSelectElement).value).toBe("write");
    expect((within(form).getByLabelText("App") as HTMLInputElement).value).toBe("clinic");
    expect((within(form).getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-01T00:00");
  });

  it("[TRP2] Apply rewrites the URL with replace, keeping the hand-off params and the untouched date spelling", async () => {
    renderAt("?pryvServiceInfoUrl=https%3A%2F%2Fcore.test%2Fservice%2Finfo&backUrl=https%3A%2F%2Fapp.test&backLabel=App&lang=en&from=2026-10-01");
    const form = await screen.findByRole("form", { name: "Audit trail" });
    fireEvent.change(within(form).getByLabelText("Kind"), { target: { value: "error" } });
    fireEvent.change(within(form).getByLabelText("App"), { target: { value: " diary-app " } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("kind=error"));
    const where = screen.getByTestId("where");
    expect(where.getAttribute("data-nav")).toBe("REPLACE");
    const q = new URLSearchParams(where.textContent!);
    expect(q.get("pryvServiceInfoUrl")).toBe("https://core.test/service/info");
    expect(q.get("backUrl")).toBe("https://app.test");
    expect(q.get("backLabel")).toBe("App");
    expect(q.get("lang")).toBe("en");
    expect(q.get("from")).toBe("2026-10-01");
    expect(q.get("app")).toBe("diary-app");
    expect(q.has("to")).toBe(false);
    await waitFor(() => {
      const last = trailCalls().at(-1)!;
      expect(last.types).toEqual(["audit-log/pryv-api-error"]);
      expect(last.streams).toEqual([{ any: [":_audit:access-app-1"] }]);
    });
  });

  it("[TRP3] as is read once and dropped from the address", async () => {
    renderAt("?as=" + encodeURIComponent("not a username!") + "&backLabel=App");
    expect(await screen.findByText(/cannot exist and was ignored/)).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("?backLabel=App");
    expect(document.body.textContent).not.toContain("not a username!");
  });

  it("[TRP4] the Access column names the access, linking to its page; hidden when the view is one access", async () => {
    renderAt("?backLabel=App");
    const link = await screen.findByRole("link", { name: "diary-app" });
    expect(link.getAttribute("href")).toBe("/account/audit-access/app-1?backLabel=App");
    expect(screen.getByRole("link", { name: "Clinic app" }).getAttribute("href")).toBe("/account/audit-access/g1%3A2?backLabel=App");
    expect(screen.getByRole("columnheader", { name: "Access" })).toBeTruthy();
    expect(trailCalls()[0].streams).toEqual([":_audit:actions"]);
    cleanup();
    renderAt("?access=app-1");
    await screen.findByText("events.get", { selector: "td" });
    expect(screen.queryByRole("columnheader", { name: "Access" })).toBeNull();
    expect(screen.getByTestId("trail-access-filter").textContent).toContain("Showing the entries of diary-app.");
  });

  it("[TRP5] a revoked access still lists its rows, named from its deletion record", async () => {
    conn.deletions = [{ id: "gone-1", name: "old-app", type: "app", deleted: 1789000000 }];
    conn.events = [{ id: "r1", time: 1789000000, type: "audit-log/pryv-api", streamIds: [":_audit:access-gone-1", ":_audit:action-events.get"], content: {} }];
    renderAt("?access=gone-1:2");
    await screen.findByText("events.get", { selector: "td" });
    expect(trailCalls()[0].streams).toEqual([{ any: [":_audit:access-gone-1"] }]);
    const line = screen.getByTestId("trail-access-filter");
    expect(line.textContent).toContain("Showing the entries of old-app.");
    expect(within(line).getByText("removed")).toBeTruthy();
    expect(within(line).getByRole("link", { name: "Show every access" }).getAttribute("href")).toBe("/account/audit");
  });

  it("[TRP6] app matching no access: a notice, an empty table, and no request for the whole log", async () => {
    renderAt("?app=nobody&access=app-1");
    expect(await screen.findByText("No access of this account matches nobody.")).toBeTruthy();
    expect(screen.getByText("No audit entries match these filters.")).toBeTruthy();
    expect(trailCalls()).toHaveLength(0);
  });

  it("[TRP7] entries show endpoints without their token, and the caller label as not verified", async () => {
    renderAt("");
    const label = await screen.findByText("Caller label (not verified): nurse-desk");
    expect(label.closest("td")?.textContent).toContain("10.0.0.1");
    expect(screen.getByText('{"capabilityUrl":"https://***@core.example.com/bob/"}')).toBeTruthy();
    expect(screen.getByText(/could not reach https:\/\/\*\*\*@core\.example\.com\/bob\//)).toBeTruthy();
    for (const token of ["q5tok3n", "m6tok3n"]) expect(document.body.innerHTML).not.toContain(token);
  });

  it("[TRP8] the action list cannot be read: a class kind says so instead of listing everything", async () => {
    conn.api.mockImplementation(async (calls: Call[]) =>
      calls.map((c) => {
        if (c.method === "accesses.get") return { accesses: conn.accesses };
        if (c.method === "streams.get") return { error: { id: "forbidden", message: "no" } };
        return { events: conn.events };
      }),
    );
    renderAt("?kind=read");
    expect(await screen.findByText(/the kind filter cannot be applied/)).toBeTruthy();
    expect(trailCalls()).toHaveLength(0);
  });
});
