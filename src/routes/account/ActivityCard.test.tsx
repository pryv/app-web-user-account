// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [ACTV] The access page's Activity card: `audit.getSummary` (day buckets in
 * the browser's time zone, the access's base id) and the last error in one
 * batch; on a core without the method (`invalid-method`), the former 7-day
 * `events.get` window on the access's base stream, rows bucketed by local day
 * with batch envelopes dropped and the truncation notice at 1000 rows; no
 * chart when the audit trail is off (`unavailable-method`); the lifetime
 * block only when the core returns `usage`, and the Raw data link to the
 * Audit trail. ACT1..ACT7 run against a core without the method.
 */

import { ActivityCard } from "./ActivityCard";
import type { AccessUsage, AuditEvent } from "../../lib/audit";

const NOW = new Date(2026, 9, 15, 14, 0, 0);
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).getTime() / 1000;
const row = (id: string, action: string, time: number, error = false): AuditEvent => ({
  id,
  time,
  type: error ? "audit-log/pryv-api-error" : "audit-log/pryv-api",
  streamIds: [":_audit:access-app-1", ":_audit:action-" + action],
  content: error ? { id: "forbidden", message: "denied for https://t0k3n@core.example/x/" } : {},
});

type Call = { method: string; params: Record<string, unknown> };
let windowRows: AuditEvent[] = [];
let lastError: AuditEvent[] = [];
/** When set, the last-error call answers this API error instead. */
let lastErrorRefusal: { id: string; message: string } | null = null;
const OLD_CORE = { error: { id: "invalid-method", message: 'Invalid method id "audit.getSummary"' } };
/** What `audit.getSummary` answers: by default, a core without the method. */
let summaryAnswer: Record<string, unknown> = OLD_CORE;
const api = vi.fn(async (calls: Call[]) =>
  calls.map((c) =>
    c.method === "audit.getSummary"
      ? summaryAnswer
      : c.params.types != null && lastErrorRefusal != null
        ? { error: lastErrorRefusal }
        : { events: c.params.types != null ? lastError : windowRows },
  ),
);
const connection = { api } as never;

const day = (d: number) => new Date(2026, 9, d).getTime() / 1000;
const bucket = (d: number, reads: number, writes: number, extra: Partial<Record<"session" | "other" | "errors", number>> = {}) => ({
  time: day(d),
  reads,
  writes,
  session: extra.session ?? 0,
  other: extra.other ?? 0,
  errors: extra.errors ?? 0,
  total: reads + writes + (extra.session ?? 0) + (extra.other ?? 0),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  windowRows = [];
  lastError = [];
  lastErrorRefusal = null;
  summaryAnswer = OLD_CORE;
  api.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCard(props: { usage?: AccessUsage | null; search?: string; accessId?: string } = {}) {
  return render(
    <MemoryRouter>
      <ActivityCard connection={connection} accessId={props.accessId ?? "app-1:3"} usage={props.usage} search={props.search ?? ""} />
    </MemoryRouter>,
  );
}

function tableRows(): string[][] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent ?? ""));
}

describe("[ACTV] activity card", () => {
  it("[ACT1] asks the summary and the last error; a core without the method then gets the 7-day window on the base stream", async () => {
    renderCard();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const [first, second] = api.mock.calls.map((c) => c[0]);
    expect(first).toEqual([
      {
        method: "audit.getSummary",
        params: {
          fromTime: new Date(2026, 9, 9).getTime() / 1000,
          bucket: "day",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          accessIds: ["app-1"],
        },
      },
      {
        method: "events.get",
        params: { streams: [":_audit:access-app-1"], types: ["audit-log/pryv-api-error"], limit: 1, sortAscending: false },
      },
    ]);
    expect(second).toEqual([
      {
        method: "events.get",
        params: {
          streams: [":_audit:access-app-1"],
          fromTime: new Date(2026, 9, 9).getTime() / 1000,
          limit: 1000,
          sortAscending: false,
        },
      },
    ]);
  });

  it("[ACT2] buckets reads and writes by local day; batch rows dropped; session, other and errors counted", async () => {
    windowRows = [
      row("1", "events.get", at(15, 10)),
      row("2", "events.create", at(15, 9)),
      row("3", "callBatch", at(15, 9)),
      row("4", "streams.get", at(14, 23)),
      row("5", "streams.get", at(14, 1)),
      row("6", "events.get", at(13, 12), true),
      row("7", "auth.login", at(12, 8)),
      row("8", "events.frobnicate", at(11, 8)),
      row("9", "events.update", at(9, 0)),
    ];
    renderCard();
    await screen.findByRole("img");
    expect(tableRows().map(([reads, writes]) => [Number(reads), Number(writes)])).toEqual([
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Calls per day over the last 7 days: 4 reads and 2 writes in total.",
    );
    expect(screen.getByTestId("activity-caption").textContent).toBe("Session calls: 1 · other calls: 1 · 1 error");
    expect(screen.queryByText(/entries in the last 7 days/)).toBeNull();
  });

  it("[ACT3] 1000 rows: the truncation notice, and the oldest days marked incomplete", async () => {
    // Every 5 minutes back from Oct 15 noon: the oldest row read is on Oct 12.
    windowRows = Array.from({ length: 1000 }, (_, i) => row("r" + i, "events.get", at(15, 12) - i * 60 * 5));
    renderCard();
    expect(await screen.findByText("1000+ entries in the last 7 days; the chart shows the most recent 1000.")).toBeTruthy();
    const days = within(screen.getByRole("table")).getAllByRole("rowheader").map((h) => /incomplete/.test(h.textContent ?? ""));
    expect(days).toEqual([true, true, true, true, false, false, false]);
  });

  it("[ACT4] the last error comes from the second call, masked; none says so", async () => {
    lastError = [row("e", "events.get", at(2, 10), true)];
    renderCard();
    const last = within(await screen.findByTestId("activity-last-error"));
    expect(await last.findByText("forbidden: denied for https://***@core.example/x/")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("t0k3n");
    cleanup();
    lastError = [];
    renderCard();
    expect(await within(screen.getByTestId("activity-last-error")).findByText("No error recorded.")).toBeTruthy();
  });

  it("[ACT5] lifetime counts only when the core returns usage", async () => {
    renderCard();
    await screen.findByRole("img");
    expect(screen.queryByTestId("activity-lifetime")).toBeNull();
    cleanup();
    renderCard({ usage: { total: 42, reads: 30, writes: 10, session: 2, other: 0, byMethod: { "events.get": 30 } } });
    const lifetime = within(screen.getByTestId("activity-lifetime"));
    expect(lifetime.getByText("Calls").nextElementSibling?.textContent).toBe("42");
    expect(lifetime.getByText("Reads").nextElementSibling?.textContent).toBe("30");
    expect(lifetime.getByText("Writes").nextElementSibling?.textContent).toBe("10");
    expect(lifetime.getByText("Session").nextElementSibling?.textContent).toBe("2");
    expect(lifetime.getByText("Other").nextElementSibling?.textContent).toBe("0");
  });

  it("[ACT6] Raw data opens the Audit trail on the access's base id, keeping the query", async () => {
    renderCard({ search: "?pryvServiceInfoUrl=x&backLabel=App" });
    const link = screen.getByRole("link", { name: "Raw data" });
    expect(link.getAttribute("href")).toBe("/account/audit?pryvServiceInfoUrl=x&backLabel=App&access=app-1");
    await screen.findByRole("img");
  });

  it("[ACT7] the last-error call answers an error: the section says so (masked) instead of loading forever", async () => {
    lastErrorRefusal = { id: "forbidden", message: "refused for https://k7tok3n@core.example/x/" };
    windowRows = [row("1", "events.get", at(15, 10))];
    renderCard();
    await screen.findByRole("img");
    const last = within(screen.getByTestId("activity-last-error"));
    expect(await last.findByText(/Could not load the last error of this access\./)).toBeTruthy();
    expect(last.getByText("refused for https://***@core.example/x/")).toBeTruthy();
    expect(last.queryByText(/Loading/)).toBeNull();
    expect(last.queryByText("No error recorded.")).toBeNull();
    expect(document.body.innerHTML).not.toContain("k7tok3n");
    // The 7-day chart is unaffected.
    expect(screen.getByTestId("activity-caption").textContent).toContain("0 errors");
  });

  it("[ACT8] a core with audit.getSummary: the chart and counts are the core's, one request, no window", async () => {
    summaryAnswer = {
      summary: {
        bucket: "day",
        timezone: "Europe/Zurich",
        fromTime: day(9),
        toTime: NOW.getTime() / 1000,
        buckets: [
          bucket(9, 0, 1),
          bucket(10, 0, 0),
          bucket(11, 0, 0, { other: 1 }),
          bucket(12, 0, 0, { session: 1 }),
          bucket(13, 1, 0, { errors: 1 }),
          bucket(14, 2, 0),
          bucket(15, 1, 1),
        ],
      },
    };
    // Window rows would give other figures: they must not be read.
    windowRows = [row("1", "events.get", at(15, 10))];
    renderCard();
    await screen.findByRole("img");
    expect(api).toHaveBeenCalledTimes(1);
    expect(tableRows().map(([reads, writes]) => [Number(reads), Number(writes)])).toEqual([
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Calls per day over the last 7 days: 4 reads and 2 writes in total.",
    );
    expect(screen.getByTestId("activity-caption").textContent).toBe("Session calls: 1 · other calls: 1 · 1 error");
    expect(screen.queryByText(/entries in the last 7 days/)).toBeNull();
  });

  it("[ACT9] audit trail off (unavailable-method): no chart, the rest of the card stays", async () => {
    summaryAnswer = { error: { id: "unavailable-method", message: "The audit trail is disabled on this platform." } };
    renderCard();
    expect(await within(screen.getByTestId("activity-last-error")).findByText("No error recorded.")).toBeTruthy();
    expect(screen.queryByTestId("activity-week")).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Raw data" })).toBeTruthy();
  });

  it("[ACTA] any other summary error is shown (masked), without falling back", async () => {
    summaryAnswer = { error: { id: "too-many-requests", message: "busy at https://z9tok3n@core.example/x/" } };
    renderCard();
    expect(await screen.findByText("busy at https://***@core.example/x/")).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).not.toContain("z9tok3n");
  });
});
