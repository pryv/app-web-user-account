import { describe, it, expect } from "vitest";
import { REQUEST_NOT_FOUND_MESSAGE, scopeUpdateFailure, scopeUpdateSuccessNote } from "./scopeUpdate";

function cmcError(message: string, id: string): Error {
  const e = new Error(message) as Error & { id: string };
  e.name = "CmcError";
  e.id = id;
  return e;
}

describe("scopeUpdateFailure", () => {
  it("hands the platform's error id back to the app, not the English message", () => {
    const f = scopeUpdateFailure(cmcError("CMC scope update failed: cmc-scope-request-expired", "cmc-scope-request-expired"));
    expect(f.reason).toBe("cmc-scope-request-expired");
    expect(f.message).toBe("CMC scope update failed: cmc-scope-request-expired");
  });

  it("explains a request that is not on the account", () => {
    for (const id of ["cmc-scope-request-not-found", "unknown-resource"]) {
      const f = scopeUpdateFailure(cmcError("whatever", id));
      expect(f).toEqual({ reason: id, message: REQUEST_NOT_FOUND_MESSAGE });
    }
  });

  it("falls back to the message when there is no id", () => {
    expect(scopeUpdateFailure(new Error("network down"))).toEqual({ reason: "network down", message: "network down" });
    expect(scopeUpdateFailure("boom", "Could not approve.")).toEqual({ reason: "Could not approve.", message: "Could not approve." });
  });
});

describe("scopeUpdateSuccessNote", () => {
  it("adds a note only when the collector was not reached", () => {
    expect(scopeUpdateSuccessNote({ peerNotified: false })).toMatch(/could not be notified/);
    expect(scopeUpdateSuccessNote({ peerNotified: true })).toBeNull();
    expect(scopeUpdateSuccessNote(undefined)).toBeNull();
  });
});
