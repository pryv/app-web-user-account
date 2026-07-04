import { describe, it, expect } from "vitest";
import {
  buildAuditGetParams,
  auditAction,
  isAuditError,
  dateInputToTime,
  buildDataGetParams,
  filterEventsByAccess,
  eventRelation,
  DATA_BATCH_LIMIT,
  AUDIT_TYPE_ERROR,
  AUDIT_TYPE_VALID,
} from "./audit";

describe("buildAuditGetParams", () => {
  it("targets the access's audit stream with pagination", () => {
    const p = buildAuditGetParams({ accessId: "ck123", page: 2, pageSize: 20 });
    expect(p.streams).toEqual([":_audit:access-ck123"]);
    expect(p.limit).toBe(21); // one extra row probes for a next page
    expect(p.skip).toBe(40);
    expect(p.sortAscending).toBe(false);
    expect(p).not.toHaveProperty("fromTime");
    expect(p).not.toHaveProperty("types");
  });

  it("combines access and action streams with AND semantics", () => {
    const p = buildAuditGetParams({ accessId: "a1", action: "events.get", page: 0, pageSize: 15 });
    expect(p.streams).toEqual([
      { any: [":_audit:access-a1"], all: [":_audit:action-events.get"] },
    ]);
  });

  it("carries time range and errors-only filters", () => {
    const p = buildAuditGetParams({
      accessId: "a",
      fromTime: 100,
      toTime: 200,
      errorsOnly: true,
      page: 0,
      pageSize: 10,
    });
    expect(p.fromTime).toBe(100);
    expect(p.toTime).toBe(200);
    expect(p.types).toEqual([AUDIT_TYPE_ERROR]);
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
