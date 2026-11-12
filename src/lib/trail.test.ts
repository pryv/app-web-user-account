import { describe, it, expect } from "vitest";
import {
  parseTrailSearch,
  parseTrailTime,
  resolveAppAccessIds,
  searchWith,
  timeToInput,
  withoutTrailFilters,
} from "./trail";

/**
 * [TRLQ] The Audit trail URL contract: `from` / `to` parsing, `kind` and
 * `action` validation, `access` reduced to its base id, `app` resolved to the
 * grant, its sessions (exchange-derived ones included) and same-name accesses.
 */

describe("[TRLQ] trail URL parsing", () => {
  it("[TRQ11] from / to: Unix seconds, ISO date-times, local dates; a date-only to is the end of that day", () => {
    expect(parseTrailTime("1789000000")).toBe(1789000000);
    expect(parseTrailTime("1789000000.5")).toBe(1789000000.5);
    expect(parseTrailTime("2026-10-01T12:00:00Z")).toBe(Date.UTC(2026, 9, 1, 12) / 1000);
    expect(parseTrailTime("2026-10-01T12:00")).toBe(new Date(2026, 9, 1, 12).getTime() / 1000);
    expect(parseTrailTime("2026-10-01")).toBe(new Date(2026, 9, 1).getTime() / 1000);
    expect(parseTrailTime("2026-10-01", true)).toBe(new Date(2026, 9, 2).getTime() / 1000 - 0.001);
  });

  it("[TRQ12] an unreadable time is ignored", () => {
    expect(parseTrailTime("yesterday")).toBeUndefined();
    expect(parseTrailTime("2026-02-31")).toBeUndefined();
    expect(parseTrailTime("")).toBeUndefined();
    expect(parseTrailTime(null)).toBeUndefined();
    expect(parseTrailSearch("?from=nope&to=never")).toEqual({});
  });

  it("[TRQ13] kind and action are validated; access is reduced to its base id, ignored when not an id", () => {
    expect(parseTrailSearch("?kind=write&action=events.get&access=ck1:3")).toEqual({
      kind: "write",
      action: "events.get",
      access: "ck1",
    });
    expect(parseTrailSearch("?kind=everything&action=" + encodeURIComponent("<script>"))).toEqual({});
    expect(parseTrailSearch("?kind=error").kind).toBe("error");
    expect(parseTrailSearch("?access=ck1_x-2").access).toBe("ck1_x-2");
    expect(parseTrailSearch("?access=%20ck1:3%20").access).toBe("ck1");
    for (const refused of ["you have been hacked", "ck1\"x", "<b>x</b>", "a".repeat(101), "*", ":3"]) {
      expect(parseTrailSearch("?access=" + encodeURIComponent(refused))).toEqual({});
    }
  });

  it("[TRQ14] app is kept as given, trimmed; hand-off params are not filters", () => {
    expect(parseTrailSearch("?app=%20clinic%20&pryvServiceInfoUrl=x&backUrl=y&lang=en")).toEqual({ app: "clinic" });
  });

  it("[TRQ15] searchWith sets and removes in place; withoutTrailFilters keeps only the rest", () => {
    expect(searchWith("?pryvServiceInfoUrl=x&kind=read", { kind: "write", access: "a1" })).toBe(
      "?pryvServiceInfoUrl=x&kind=write&access=a1",
    );
    expect(searchWith("?kind=read", { kind: null })).toBe("");
    expect(withoutTrailFilters("?access=a&app=b&from=1&to=2&kind=read&action=x&backUrl=u&lang=en")).toBe("?backUrl=u&lang=en");
  });

  it("[TRQ16] timeToInput renders local time for a datetime-local field", () => {
    expect(timeToInput(new Date(2026, 9, 1, 8, 5).getTime() / 1000)).toBe("2026-10-01T08:05");
    expect(timeToInput(undefined)).toBe("");
  });
});

describe("[TRLQ] app resolution", () => {
  const ACCESSES = [
    { id: "g1:2", name: "oauth-grant:clinic" },
    { id: "s1", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1" } } },
    { id: "x1", name: "oauth:clinic", clientData: { oauth: { dataGrantId: "g1", exchange: { audience: "rs" } } } },
    { id: "p1", name: "clinic", type: "personal" },
    { id: "other", name: "oauth-grant:diary" },
    { id: "gone", name: "oauth:clinic", deleted: 1789000000 },
  ];

  it("[TRQ17] the grant, its sessions (exchange-derived included), same-name accesses and removed ones", () => {
    expect(resolveAppAccessIds(ACCESSES, "clinic")).toEqual(["g1", "s1", "x1", "p1", "gone"]);
  });

  it("[TRQ18] no match is an empty set", () => {
    expect(resolveAppAccessIds(ACCESSES, "unknown")).toEqual([]);
  });
});
