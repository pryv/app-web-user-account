import { describe, it, expect } from "vitest";
import {
  buildTrailGetParams,
  auditAccessId,
  auditAction,
  isAuditError,
  dateInputToTime,
  buildDataGetParams,
  filterEventsByAccess,
  eventRelation,
  parseAttribution,
  sameAccess,
  accessesWithDeletions,
  findAccess,
  DATA_BATCH_LIMIT,
  AUDIT_TYPE_ERROR,
  AUDIT_TYPE_VALID,
} from "./audit";

/**
 * [TRLQ] The Audit trail's events.get params: every streams block shape,
 * `action` over a class `kind`, `kind=error` as types, versions read from the
 * base stream, nothing asked when nothing can match.
 */
describe("[TRLQ] buildTrailGetParams", () => {
  const ACTIONS = ["events.get", "events.create", "streams.get", "auth.login", "callBatch", "events.frobnicate"];
  const base = { actions: ACTIONS, page: 0, pageSize: 15 };
  const A = (id: string) => ":_audit:access-" + id;
  const M = (id: string) => ":_audit:action-" + id;

  it("[TRQ1] pagination and order, with the +1 next-page probe", () => {
    const p = buildTrailGetParams({ ...base, accessIds: ["a1"], page: 2, pageSize: 20 })!;
    expect(p.limit).toBe(21);
    expect(p.skip).toBe(40);
    expect(p.sortAscending).toBe(false);
    expect(p).not.toHaveProperty("fromTime");
    expect(p).not.toHaveProperty("types");
  });

  it("[TRQ2] accesses only: one any block, versions reduced to the base stream", () => {
    expect(buildTrailGetParams({ ...base, accessIds: ["ck123:2", "b2", "ck123"] })!.streams).toEqual([
      { any: [A("ck123"), A("b2")] },
    ]);
  });

  it("[TRQ3] accesses and an action: AND through all", () => {
    expect(buildTrailGetParams({ ...base, accessIds: ["a1", "a2"], action: "events.get" })!.streams).toEqual([
      { any: [A("a1"), A("a2")], all: [M("events.get")] },
    ]);
  });

  it("[TRQ4] accesses and a class: one block per access, any of the class's actions", () => {
    expect(buildTrailGetParams({ ...base, accessIds: ["a1", "a2"], kind: "read" })!.streams).toEqual([
      { any: [M("events.get"), M("streams.get")], all: [A("a1")] },
      { any: [M("events.get"), M("streams.get")], all: [A("a2")] },
    ]);
    expect(buildTrailGetParams({ ...base, accessIds: ["a1"], kind: "write" })!.streams).toEqual([
      { any: [M("events.create")], all: [A("a1")] },
    ]);
  });

  it("[TRQ5] no access: a class, an action, or the whole log", () => {
    expect(buildTrailGetParams({ ...base, accessIds: null, kind: "session" })!.streams).toEqual([
      { any: [M("auth.login")] },
    ]);
    expect(buildTrailGetParams({ ...base, accessIds: null, action: "events.get" })!.streams).toEqual([
      { any: [M("events.get")] },
    ]);
    expect(buildTrailGetParams({ ...base, accessIds: null })!.streams).toEqual([":_audit:actions"]);
  });

  it("[TRQ6] action wins over a class kind; with kind=error both apply", () => {
    expect(buildTrailGetParams({ ...base, accessIds: ["a1"], kind: "write", action: "events.get" })!.streams).toEqual([
      { any: [A("a1")], all: [M("events.get")] },
    ]);
    const err = buildTrailGetParams({ ...base, accessIds: ["a1"], kind: "error", action: "events.get" })!;
    expect(err.streams).toEqual([{ any: [A("a1")], all: [M("events.get")] }]);
    expect(err.types).toEqual([AUDIT_TYPE_ERROR]);
  });

  it("[TRQ7] kind=error alone: error types over the accesses", () => {
    const p = buildTrailGetParams({ ...base, accessIds: ["a1"], kind: "error", fromTime: 100, toTime: 200 })!;
    expect(p.streams).toEqual([{ any: [A("a1")] }]);
    expect(p.types).toEqual([AUDIT_TYPE_ERROR]);
    expect(p.fromTime).toBe(100);
    expect(p.toTime).toBe(200);
  });

  it("[TRQ8] nothing can match: no access, or a class no action of the account is in", () => {
    expect(buildTrailGetParams({ ...base, accessIds: [] })).toBeNull();
    expect(buildTrailGetParams({ ...base, accessIds: ["a1"], kind: "write", actions: ["events.get"] })).toBeNull();
  });

  it("[TRQ9] callBatch is in no class: a class never lists batch envelopes", () => {
    for (const kind of ["read", "write", "session"] as const) {
      expect(JSON.stringify(buildTrailGetParams({ ...base, accessIds: null, kind }))).not.toContain("callBatch");
    }
  });

  it("[TRQ10] the access an entry is filed under, by its base id", () => {
    expect(auditAccessId({ id: "e", time: 1, type: AUDIT_TYPE_VALID, streamIds: [M("events.get"), A("x1"), A("x1:2")] })).toBe("x1");
    expect(auditAccessId({ id: "e", time: 1, type: AUDIT_TYPE_VALID })).toBeNull();
  });
});

describe("audit event helpers", () => {
  it("extracts the action from the action stream id", () => {
    expect(
      auditAction({
        id: "e1",
        time: 1,
        type: AUDIT_TYPE_VALID,
        streamIds: [":_audit:access-a1", ":_audit:action-events.get"],
      }),
    ).toBe("events.get");
  });

  it("falls back to content.action, then to a placeholder", () => {
    expect(
      auditAction({ id: "e2", time: 1, type: AUDIT_TYPE_VALID, content: { action: "auth.login" } }),
    ).toBe("auth.login");
    expect(auditAction({ id: "e3", time: 1, type: AUDIT_TYPE_VALID })).toBe("?");
  });

  it("flags error entries by type", () => {
    expect(isAuditError({ id: "e", time: 1, type: AUDIT_TYPE_ERROR })).toBe(true);
    expect(isAuditError({ id: "e", time: 1, type: AUDIT_TYPE_VALID })).toBe(false);
  });
});

describe("data created/modified helpers", () => {
  it("builds a bounded, all-states batch query", () => {
    const p = buildDataGetParams({ fromTime: 5 });
    expect(p.limit).toBe(DATA_BATCH_LIMIT);
    expect(p.state).toBe("all");
    expect(p.fromTime).toBe(5);
    expect(p).not.toHaveProperty("toTime");
  });

  it("filters events by createdBy or modifiedBy", () => {
    const events = [
      { id: "1", time: 1, type: "note/txt", createdBy: "a1", modifiedBy: "a1" },
      { id: "2", time: 2, type: "note/txt", createdBy: "zz", modifiedBy: "a1" },
      { id: "3", time: 3, type: "note/txt", createdBy: "zz", modifiedBy: "zz" },
    ];
    expect(filterEventsByAccess(events, "a1").map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("labels the relation, counting modified only when distinct from created", () => {
    expect(
      eventRelation({ id: "1", time: 1, type: "t/t", createdBy: "a1", created: 5, modified: 5, modifiedBy: "a1" }, "a1"),
    ).toBe("created");
    expect(
      eventRelation({ id: "2", time: 1, type: "t/t", createdBy: "zz", modifiedBy: "a1" }, "a1"),
    ).toBe("modified");
    expect(
      eventRelation({ id: "3", time: 1, type: "t/t", createdBy: "a1", created: 5, modified: 9, modifiedBy: "a1" }, "a1"),
    ).toBe("created + modified");
  });
});

describe("[ATBN] access attribution", () => {
  it("[ATB1] parses a stored reference with or without serial and caller label", () => {
    expect(parseAttribution("ck1")).toEqual({ base: "ck1" });
    expect(parseAttribution("ck1:3")).toEqual({ base: "ck1" });
    expect(parseAttribution("ck1 member-42")).toEqual({ base: "ck1", callerId: "member-42" });
    expect(parseAttribution("ck1:3 member-42")).toEqual({ base: "ck1", callerId: "member-42" });
    // The caller label is free text: a colon or a space in it stays in it.
    expect(parseAttribution("ck1 dr x:7")).toEqual({ base: "ck1", callerId: "dr x:7" });
  });

  it("[ATB2] sameAccess compares the access, whatever the version or caller label", () => {
    expect(sameAccess("ck1:2 member", "ck1")).toBe(true);
    expect(sameAccess("ck1", "ck1:5")).toBe(true);
    expect(sameAccess("ck1", "ck2")).toBe(false);
    expect(sameAccess(undefined, "ck1")).toBe(false);
  });

  it("[ATB3] lists live accesses first, then the removed ones, and finds either", () => {
    const list = accessesWithDeletions({
      accesses: [{ id: "live-1", name: "live" }, { id: "ver-1:2", name: "versioned" }],
      accessDeletions: [{ id: "gone-1", name: "gone", deleted: 1789000000 }],
    });
    expect(list.map((a) => a.id)).toEqual(["live-1", "ver-1:2", "gone-1"]);
    expect(findAccess(list, "gone-1")?.name).toBe("gone");
    expect(findAccess(list, "gone-1 member-42")?.deleted).toBe(1789000000);
    expect(findAccess(list, "ver-1")?.name).toBe("versioned");
    expect(findAccess(list, "ver-1:1 member")?.name).toBe("versioned");
    expect(findAccess(list, "nope")).toBeUndefined();
    expect(findAccess(list, undefined)).toBeUndefined();
    expect(accessesWithDeletions({})).toEqual([]);
  });

  it("[ATB4] data written with a caller label or under a later version counts for the access", () => {
    const events = [
      { id: "1", time: 1, type: "note/txt", createdBy: "a1 member-42" },
      { id: "2", time: 2, type: "note/txt", createdBy: "zz", modifiedBy: "a1:2" },
      { id: "3", time: 3, type: "note/txt", createdBy: "a10" },
    ];
    expect(filterEventsByAccess(events, "a1").map((e) => e.id)).toEqual(["1", "2"]);
    expect(eventRelation(events[0], "a1")).toBe("created");
    expect(eventRelation(events[1], "a1")).toBe("modified");
  });
});

describe("dateInputToTime", () => {
  it("converts datetime-local values to Unix seconds", () => {
    const t = dateInputToTime("2026-07-03T12:00");
    expect(t).toBe(new Date("2026-07-03T12:00").getTime() / 1000);
  });

  it("returns undefined for empty or invalid input", () => {
    expect(dateInputToTime("")).toBeUndefined();
    expect(dateInputToTime("nonsense")).toBeUndefined();
  });
});
