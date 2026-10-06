import { describe, it, expect } from "vitest";
import type { ControlledRecord } from "@pryv/delegation";
import { asParam, withoutAs, resolveAs } from "./auditAs";

const rec = (username: string, status: string, hostSlug = "core-b"): ControlledRecord =>
  ({ relId: "rel-" + username, controlled: { username, hostSlug }, status, requestedAt: 1 }) as ControlledRecord;

const base = { selfUsername: "parent", actingUsername: null, controlled: [rec("kid-a", "active"), rec("kid-b", "invite"), rec("kid-c", "stale")] };

describe("[AUAS] ?as= on the access details page", () => {
  it("[AUA1] reads the parameter, and removes only it", () => {
    expect(asParam("?as=kid-a&pryvServiceInfoUrl=x")).toBe("kid-a");
    expect(asParam("?pryvServiceInfoUrl=x")).toBeNull();
    expect(asParam("?as=")).toBeNull();
    expect(asParam("")).toBeNull();
    expect(withoutAs("?as=kid-a&pryvServiceInfoUrl=https%3A%2F%2Fr.test%2F&backUrl=https%3A%2F%2Fapp.test%2F&backLabel=App")).toBe(
      "?pryvServiceInfoUrl=https%3A%2F%2Fr.test%2F&backUrl=https%3A%2F%2Fapp.test%2F&backLabel=App",
    );
    expect(withoutAs("?as=kid-a")).toBe("");
    expect(withoutAs("")).toBe("");
  });

  it("[AUA2] own or acted-for account: nothing; active managed: offer; anything else: one same answer", () => {
    expect(resolveAs({ ...base, as: null })).toEqual({ kind: "none" });
    expect(resolveAs({ ...base, as: "parent" })).toEqual({ kind: "none" });
    // The account acted for, even when it is not in the list.
    expect(resolveAs({ ...base, as: "kid-z", actingUsername: "kid-z" })).toEqual({ kind: "none" });
    expect(resolveAs({ ...base, as: "kid-a" })).toEqual({ kind: "offer", username: "kid-a", hostSlug: "core-b" });
    // Invite, stale and unknown cannot be told apart (the leak check).
    const invite = resolveAs({ ...base, as: "kid-b" });
    expect(invite).toEqual({ kind: "not-managed", username: "kid-b" });
    expect(resolveAs({ ...base, as: "kid-c" })).toEqual({ kind: "not-managed", username: "kid-c" });
    expect(resolveAs({ ...base, as: "kid-x" })).toEqual({ kind: "not-managed", username: "kid-x" });
    expect(Object.keys(invite)).toEqual(Object.keys(resolveAs({ ...base, as: "kid-x" })));
  });

  it("[AUA3] the value is a username or it is ignored, never echoed", () => {
    expect(resolveAs({ ...base, as: "KID-A " })).toEqual({ kind: "offer", username: "kid-a", hostSlug: "core-b" });
    for (const as of ["<b>kid</b>", "k".repeat(300), "ab"]) {
      expect(resolveAs({ ...base, as })).toEqual({ kind: "ignored" });
    }
  });
});
