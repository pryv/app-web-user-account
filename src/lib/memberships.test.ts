import { describe, it, expect } from "vitest";
import { CmcError, errorIds } from "@pryv/cmc";
import {
  accountLabel,
  acceptScopeFor,
  capabilityUrlFromInput,
  isTeamStream,
  membershipFailure,
  requestedTeams,
  streamNamesOf,
  sweepCounts,
  sweepInProgress,
  sweepReasonKey,
  sweepStatusKey,
  teamName,
} from "./memberships";
import i18n from "../i18n";

/** [MBRL] Group memberships, administrator side: the pure helpers. */

describe("[MBRL] memberships helpers", () => {
  it("[MBR1] a team stream is an app stream outside chats and collectors", () => {
    expect(isTeamStream(":_cmc:apps:practice")).toBe(true);
    expect(isTeamStream(":_cmc:apps:practice:team-a")).toBe(true);
    expect(isTeamStream(":_cmc:apps:practice:chats:bob--core")).toBe(false);
    expect(isTeamStream(":_cmc:apps:practice:collectors")).toBe(false);
    expect(isTeamStream(":_cmc:inbox")).toBe(false);
    expect(isTeamStream(":_cmc:apps:")).toBe(false);
    expect(isTeamStream("diary")).toBe(false);
    expect(isTeamStream(null)).toBe(false);
  });

  it("[MBR2] the capability URL in what is pasted: the link itself, or carried by a link to this app", () => {
    const cap = "https://cap-tok@bob.core.test/";
    expect(capabilityUrlFromInput("  " + cap + "  ")).toBe(cap);
    expect(
      capabilityUrlFromInput("https://app.test/account/memberships?capabilityUrl=" + encodeURIComponent(cap)),
    ).toBe(cap);
    expect(capabilityUrlFromInput("https://app.test/cmc-accept?capability=" + encodeURIComponent(cap))).toBe(cap);
    // Not a capability: no token, not a URL, not http(s).
    expect(capabilityUrlFromInput("https://bob.core.test/")).toBeNull();
    expect(capabilityUrlFromInput("hello")).toBeNull();
    expect(capabilityUrlFromInput("")).toBeNull();
    expect(capabilityUrlFromInput("javascript:alert(1)")).toBeNull();
    expect(capabilityUrlFromInput("https://app.test/?capabilityUrl=javascript%3Aalert(1)")).toBeNull();
  });

  it("[MBR3] the answer is recorded under the app the requested teams belong to", () => {
    expect(acceptScopeFor([{ streamId: ":_cmc:apps:practice:team-a" }, { streamId: ":_cmc:apps:practice:team-b" }])).toBe(
      ":_cmc:apps:practice",
    );
    expect(acceptScopeFor([{ streamId: "diary" }, { streamId: ":_cmc:apps:study" }])).toBe(":_cmc:apps:study");
    expect(acceptScopeFor([{ streamId: ":_cmc:inbox" }])).toBeNull();
    expect(acceptScopeFor([])).toBeNull();
  });

  it("[MBR4] the requested teams, in order, without duplicates or non-team streams", () => {
    expect(
      requestedTeams([
        { streamId: ":_cmc:apps:p:b" },
        { streamId: ":_cmc:apps:p:a" },
        { streamId: ":_cmc:apps:p:b" },
        { streamId: ":_cmc:inbox" },
        {},
      ]),
    ).toEqual([":_cmc:apps:p:b", ":_cmc:apps:p:a"]);
  });

  it("[MBR5] team names: the stream's name, else the last part of its id", () => {
    const names = streamNamesOf([
      { id: ":_cmc:apps:p", name: "Practice", children: [{ id: ":_cmc:apps:p:a", name: "Team A", children: [] }] },
      { id: "nameless", name: "" },
      null,
    ]);
    expect(names.get(":_cmc:apps:p:a")).toBe("Team A");
    expect(names.has("nameless")).toBe(false);
    expect(teamName(":_cmc:apps:p:a", names)).toBe("Team A");
    expect(teamName(":_cmc:apps:p:b", names)).toBe("b");
    expect(teamName(":_cmc:apps:p:b")).toBe("b");
    expect(streamNamesOf(undefined).size).toBe(0);
  });

  it("[MBR6] an account: username@host, the fallback when unknown", () => {
    expect(accountLabel({ username: "bob", host: "core.test" }, "?")).toBe("bob@core.test");
    expect(accountLabel({ username: "bob", host: null }, "?")).toBe("bob");
    expect(accountLabel({ username: null, host: "core.test" }, "?")).toBe("?");
    expect(accountLabel(null, "?")).toBe("?");
  });

  it("[MBR7] failures: the membership outcomes first, then the ones every invite shares", () => {
    expect(membershipFailure(new CmcError("x", errorIds.MEMBERSHIP_OFFER_EXPECTED), "fb").message).toBe(
      i18n.t("memberships.errNotMembership"),
    );
    // A refusal at write: the id rides on the API error's data.
    const apiError = Object.assign(new Error("wrapped"), {
      innerObject: { id: "invalid-operation", message: "m", data: { id: errorIds.MEMBERSHIP_PERMISSIONS_INVALID } },
    });
    expect(membershipFailure(apiError, "fb").message).toBe(i18n.t("memberships.errPermissionsInvalid"));
    expect(membershipFailure(new CmcError("x", errorIds.GRANTED_PERMISSIONS_NOT_SUBSET), "fb").message).toBe(
      i18n.t("memberships.errTeamsNotRequested"),
    );
    const consumed = membershipFailure(new CmcError("x", errorIds.CAPABILITY_CONSUMED), "fb");
    expect(consumed).toEqual({ message: i18n.t("cmc.acceptLinkConsumed"), tone: "info" });
    expect(membershipFailure(new Error("boom"), "fb")).toEqual({ message: "boom", tone: "danger" });
    // An id that only looks like a key of the table.
    expect(membershipFailure(new CmcError("x", "constructor"), "fb").message).toBe("x");
  });

  it("[MBR8] a sweep: counts by result, status and reason wording", () => {
    expect(
      sweepCounts([{ result: "deleted" }, { result: "deleted" }, { result: "absent" }, { result: "residual" }, { result: "odd" }]),
    ).toEqual({ deleted: 2, absent: 1, residual: 1 });
    expect(sweepInProgress("pending")).toBe(true);
    expect(sweepInProgress("delivered")).toBe(true);
    expect(sweepInProgress("completed")).toBe(false);
    expect(sweepInProgress("failed")).toBe(false);
    expect(sweepStatusKey("completed")).toBe("memberships.sweepStatusCompleted");
    expect(sweepStatusKey("failed")).toBe("memberships.sweepStatusFailed");
    expect(sweepStatusKey("delivered")).toBe("memberships.sweepStatusPending");
    for (const reason of ["revoke", "accesses.delete", "expired", "narrowed", "detach", "account-deleted", "new", null]) {
      const key = sweepReasonKey(reason);
      expect(i18n.exists(key)).toBe(true);
    }
    expect(sweepReasonKey("new")).toBe("memberships.reasonOther");
  });
});
