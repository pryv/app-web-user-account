import { describe, it, expect } from "vitest";
import {
  invitesOf,
  allDecided,
  declinedMandatory,
  acceptOrder,
  acceptedOutcome,
  boundedReason,
  scopeFromOffer,
} from "./cmcInvites";

describe("[ACI13] consent invites: pure helpers", () => {
  it("reads the request's invites, one per entry, defaults filled in", () => {
    expect(invitesOf(null)).toBeNull();
    expect(invitesOf({})).toBeNull();
    expect(invitesOf({ cmcInvites: [] })).toBeNull();
    expect(
      invitesOf({
        cmcInvites: [
          { capabilityUrl: "https://c@r.test/", mandatory: true, for: "target" },
          { capabilityUrl: "https://d@r.test/" },
          { capabilityUrl: "javascript:alert(1)", mandatory: true },
          "junk",
        ],
      }),
    ).toEqual([
      { capabilityUrl: "https://c@r.test/", mandatory: true, for: "target" },
      { capabilityUrl: "https://d@r.test/", mandatory: false, for: "self" },
      // kept (outcomes match the request one for one), unreadable
      { capabilityUrl: "", mandatory: true, for: "self" },
      { capabilityUrl: "", mandatory: false, for: "self" },
    ]);
  });

  it("decisions: all decided, the declined mandatory one, mandatory accepted first", () => {
    const invites = [
      { capabilityUrl: "a", mandatory: false, for: "self" as const },
      { capabilityUrl: "b", mandatory: true, for: "self" as const },
      { capabilityUrl: "c", mandatory: true, for: "self" as const },
    ];
    expect(allDecided([], 3)).toBe(false);
    expect(allDecided(["approve", null, "decline"], 3)).toBe(false);
    expect(allDecided(["approve", "approve", "decline"], 3)).toBe(true);
    expect(declinedMandatory(invites, ["decline", "approve", "approve"])).toBe(-1);
    expect(declinedMandatory(invites, ["approve", "approve", "decline"])).toBe(2);
    expect(acceptOrder(invites, ["approve", "approve", "approve"])).toEqual([1, 2, 0]);
    expect(acceptOrder(invites, ["approve", "decline", "approve"])).toEqual([2, 0]);
  });

  it("outcomes stay within what the core accepts", () => {
    expect(acceptedOutcome({ acceptEventId: "e1", dataGrantAccessId: null }, false)).toEqual({ acceptEventId: "e1" });
    expect(acceptedOutcome({ acceptEventId: "e1", dataGrantAccessId: "g1" }, true)).toEqual({
      acceptEventId: "e1",
      dataGrantAccessId: "g1",
      acceptedFor: "self",
    });
    expect(boundedReason("")).toBe("cmc-accept-failed");
    expect(boundedReason("x".repeat(300))).toHaveLength(256);
  });

  it("the scope of an offer: the requester's stamped scope, else its app scope, else none", () => {
    expect(scopeFromOffer({ originStreamId: ":_cmc:apps:demo:study-1", requesterMeta: { appId: "other" } })).toBe(
      ":_cmc:apps:demo:study-1",
    );
    expect(scopeFromOffer({ requesterMeta: { appId: "demo" } })).toBe(":_cmc:apps:demo");
    // Segments follow the plugin: any non-colon text (uppercase, underscore, dot), no whitespace.
    expect(scopeFromOffer({ requesterMeta: { appId: "hdsCarer" } })).toBe(":_cmc:apps:hdsCarer");
    expect(scopeFromOffer({ originStreamId: ":_cmc:apps:my_app:study.2026" })).toBe(":_cmc:apps:my_app:study.2026");
    expect(scopeFromOffer({ originStreamId: ":_cmc:inbox", requesterMeta: { appId: "Bad App" } })).toBeNull();
    expect(scopeFromOffer({ originStreamId: ":_cmc:apps:demo:chats" })).toBeNull();
    expect(scopeFromOffer({ originStreamId: ":_cmc:apps:demo::x" })).toBeNull();
    expect(scopeFromOffer({ originStreamId: ":_cmc:apps:" + Array(10).fill("a".repeat(60)).join(":") })).toBeNull();
    expect(scopeFromOffer(null)).toBeNull();
  });
});
