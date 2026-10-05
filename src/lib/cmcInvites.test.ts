import { describe, it, expect } from "vitest";
import {
  invitesOf,
  allDecided,
  declinedMandatory,
  acceptOrder,
  acceptedOutcome,
  boundedReason,
  scopeFromOffer,
  givenConsentOf,
  givenOutcome,
  settledDecisions,
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

describe("[ACIG] consent invites: a consent already given", () => {
  const grant = (over: Record<string, unknown> = {}, cmc: Record<string, unknown> = {}) => ({
    id: "g1",
    created: 200,
    clientData: { cmc: { role: "counterparty", offerEventId: "offer-1", acceptEventId: "acc-1", ...cmc } },
    ...over,
  });

  it("[ACIG1] finds the live grant minted from the offer", () => {
    expect(givenConsentOf([grant()], "offer-1", 1000)).toEqual({ accessId: "g1", acceptEventId: "acc-1", created: 200 });
  });

  it("[ACIG2] only a counterparty grant of this very offer, alive, with its accept event id", () => {
    expect(givenConsentOf([grant({}, { offerEventId: "offer-2" })], "offer-1", 1000)).toBeNull();
    expect(givenConsentOf([grant({}, { role: "requester" })], "offer-1", 1000)).toBeNull();
    expect(givenConsentOf([grant({}, { acceptEventId: null })], "offer-1", 1000)).toBeNull();
    expect(givenConsentOf([grant({ deleted: 300 })], "offer-1", 1000)).toBeNull();
    expect(givenConsentOf([grant({ expires: 999 })], "offer-1", 1000)).toBeNull();
    expect(givenConsentOf([grant({ expires: 2000 })], "offer-1", 1000)?.accessId).toBe("g1");
    expect(givenConsentOf([{ id: "x", clientData: null }, null as never, grant()], "offer-1", 1000)?.accessId).toBe("g1");
    expect(givenConsentOf([grant()], "", 1000)).toBeNull();
    expect(givenConsentOf(null, "offer-1", 1000)).toBeNull();
  });

  it("[ACIG3] with several grants of one offer, the earliest", () => {
    const later = grant({ id: "g2", created: 500 }, { acceptEventId: "acc-2" });
    expect(givenConsentOf([later, grant()], "offer-1", 1000)?.accessId).toBe("g1");
  });

  it("[ACIG5] a given invite whose grant is not known counts as undecided", () => {
    const given = { accessId: "g1", acceptEventId: "acc-1", created: 200 };
    expect(settledDecisions(["given", "given", "approve", null], [{ given }, { given: null }, undefined, undefined])).toEqual([
      "given",
      null,
      "approve",
      null,
    ]);
    expect(settledDecisions(["given"], [])).toEqual([null]);
    expect(allDecided(settledDecisions(["given", "decline"], [{ given: null }, { given: null }]), 2)).toBe(false);
  });

  it("[ACIG4] reported as the core validates an accepted outcome", () => {
    const given = { accessId: "g1", acceptEventId: "acc-1", created: 200 };
    expect(givenOutcome(given, false)).toEqual({ acceptEventId: "acc-1", dataGrantAccessId: "g1" });
    expect(givenOutcome(given, true)).toEqual({ acceptEventId: "acc-1", dataGrantAccessId: "g1", acceptedFor: "self" });
  });
});

describe("[ACIN] consent invites: the name the grant carries", () => {
  it("[ACIN1] keeps accessName when a non-empty string, as sent, cut at 256 characters", () => {
    const invites = invitesOf({
      cmcInvites: [
        { capabilityUrl: "https://c@r.test/", accessName: " Study 2026 " },
        { capabilityUrl: "https://c@r.test/", accessName: "n".repeat(300) },
        { capabilityUrl: "https://c@r.test/", accessName: "" },
        { capabilityUrl: "https://c@r.test/", accessName: 42 },
        { capabilityUrl: "https://c@r.test/", accessName: null },
        { capabilityUrl: "https://c@r.test/" },
      ],
    })!;
    expect(invites[0].accessName).toBe(" Study 2026 ");
    expect(invites[1].accessName).toBe("n".repeat(256));
    // Absent, not undefined: an entry without a usable name has no such key.
    for (const inv of invites.slice(2)) expect("accessName" in inv).toBe(false);
  });
});
