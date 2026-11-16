// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";

/**
 * [TRSM] The Audit trail's activity chart: `audit.getSummary` over the chosen
 * period in the browser's time zone (7 days by default), the view's accesses
 * passed as `accessIds`, bars per bucket and the counts caption; hidden on a
 * core without the method or with the audit trail off, and when the view
 * names no access or more than one call may; other errors shown masked;
 * asked again on Refresh.
 */

import { TrailSummary } from "./TrailSummary";

type Call = { method: string; params: Record<string, unknown> };
const NOW = new Date(2026, 9, 15, 14, 30, 0);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let answer: Record<string, unknown>;
const api = vi.fn(async (calls: Call[]) => calls.map(() => answer));
const connection = { api } as never;
const lastParams = () => (api.mock.calls.at(-1)![0] as Call[])[0].params;

function summaryOf(bucket: string, buckets: Array<[number, number, number, number?]>) {
  return {
    summary: {
      bucket,
      timezone: TZ,
      fromTime: buckets[0]?.[0] ?? 0,
      toTime: NOW.getTime() / 1000,
      buckets: buckets.map(([time, reads, writes, errors]) => ({
        time,
        reads,
        writes,
        session: 1,
        other: 0,
        errors: errors ?? 0,
        total: reads + writes + 1,
      })),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const d = (n: number) => new Date(2026, 9, n).getTime() / 1000;
  answer = summaryOf("day", [9, 10, 11, 12, 13, 14, 15].map((n) => [d(n), n === 15 ? 2 : 0, n === 14 ? 1 : 0, n === 15 ? 1 : 0]));
  api.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSummary(accessIds: string[] | null | undefined = null, refreshTick = 0) {
  return render(<TrailSummary connection={connection} accessIds={accessIds} refreshTick={refreshTick} />);
}

describe("[TRSM] audit trail activity chart", () => {
  it("[TRS1] 7 days by default: day buckets from local midnight six days ago, browser time zone, whole account", async () => {
    renderSummary();
    await screen.findByTestId("trail-summary");
    expect(api).toHaveBeenCalledTimes(1);
    expect((api.mock.calls[0][0] as Call[])[0]).toEqual({
      method: "audit.getSummary",
      params: { fromTime: new Date(2026, 9, 9).getTime() / 1000, bucket: "day", timezone: TZ },
    });
    expect(screen.getAllByTestId("activity-day")).toHaveLength(7);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Calls per period, Last 7 days: 2 reads and 1 writes in total.",
    );
    expect(screen.getByTestId("trail-summary-caption").textContent).toBe(
      "10 calls · session calls: 7 · other calls: 0 · 1 error",
    );
  });

  it("[TRS2] the period picker: 24 hours by hour, 30 days by day, 52 weeks by week from a Monday", async () => {
    renderSummary(["app-1"]);
    await screen.findByTestId("trail-summary");
    expect(lastParams().accessIds).toEqual(["app-1"]);
    const select = screen.getByLabelText("Period");
    fireEvent.change(select, { target: { value: "24h" } });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(lastParams()).toMatchObject({ bucket: "hour", fromTime: new Date(2026, 9, 14, 15).getTime() / 1000, accessIds: ["app-1"] });
    fireEvent.change(select, { target: { value: "30d" } });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    expect(lastParams()).toMatchObject({ bucket: "day", fromTime: new Date(2026, 8, 16).getTime() / 1000 });
    fireEvent.change(select, { target: { value: "52w" } });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(4));
    // 2026-10-15 is a Thursday: its week starts Monday 12 October; 51 weeks earlier is Monday 20 October 2025.
    const from = new Date(lastParams().fromTime as number * 1000);
    expect(lastParams().bucket).toBe("week");
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getDay(), from.getHours()]).toEqual([2025, 9, 20, 1, 0]);
  });

  it("[TRS3] a core without the method, or with the audit trail off: no card", async () => {
    for (const id of ["invalid-method", "unknown-resource", "unavailable-method"]) {
      answer = { error: { id, message: "no" } };
      const { container } = renderSummary();
      await waitFor(() => expect(api).toHaveBeenCalled());
      await waitFor(() => expect(container.textContent).toBe(""));
      cleanup();
      api.mockClear();
    }
  });

  it("[TRS4] no access in the view, or more than 50: no card and no request", async () => {
    const many = Array.from({ length: 51 }, (_, i) => "a" + i);
    for (const ids of [[], many]) {
      const { container } = renderSummary(ids);
      expect(container.textContent).toBe("");
      cleanup();
    }
    expect(api).not.toHaveBeenCalled();
  });

  it("[TRS5] another error is shown masked; Refresh asks again", async () => {
    answer = { error: { id: "too-many-requests", message: "busy at https://w8tok3n@core.example/x/" } };
    const { rerender } = renderSummary();
    expect(await screen.findByText("busy at https://***@core.example/x/")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("w8tok3n");
    answer = summaryOf("day", [[new Date(2026, 9, 15).getTime() / 1000, 0, 0]]);
    rerender(<TrailSummary connection={connection} accessIds={null} refreshTick={1} />);
    const caption = await screen.findByTestId("trail-summary-caption");
    expect(api).toHaveBeenCalledTimes(2);
    expect(within(caption.parentElement!).getByRole("img")).toBeTruthy();
  });
});
