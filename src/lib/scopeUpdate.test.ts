import { describe, it, expect } from "vitest";
import Pryv from "pryv";
import {
  ALREADY_ANSWERED_MESSAGE,
  OUTCOME_UNKNOWN_MESSAGE,
  REQUEST_NOT_FOUND_MESSAGE,
  answeredRequestMessage,
  scopeUpdateFailure,
  scopeUpdateSuccessNote,
} from "./scopeUpdate";
import { GRANT_REQUIRES_OWNER_ID, GRANT_REQUIRES_OWNER_MESSAGE } from "./delegation";

describe("answeredRequestMessage", () => {
  it("reports a request already answered, and nothing for an open one", () => {
    expect(answeredRequestMessage("accepted")).toMatch(/approved/);
    expect(answeredRequestMessage("refused")).toMatch(/declined/);
    expect(answeredRequestMessage(undefined)).toBeNull();
    expect(answeredRequestMessage("delivered")).toBeNull();
  });
});

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

  it("does not call a wait that ended early a failure", () => {
    for (const id of ["cmc-scope-update-outcome-unknown", "cmc-capability-timeout"]) {
      expect(scopeUpdateFailure(cmcError("timed out", id))).toEqual({ reason: id, message: OUTCOME_UNKNOWN_MESSAGE });
    }
  });

  it("explains a request that was already answered", () => {
    const f = scopeUpdateFailure(cmcError("x", "cmc-scope-request-already-answered"));
    expect(f).toEqual({ reason: "cmc-scope-request-already-answered", message: ALREADY_ANSWERED_MESSAGE });
  });

  it("[GRSU] explains a grant refused to a token obtained through a delegation", () => {
    const e = new Pryv.PryvError("Error for api method: \"events.create\"", {
      id: "invalid-operation",
      message: "not allowed",
      data: { id: GRANT_REQUIRES_OWNER_ID },
    });
    expect(scopeUpdateFailure(e)).toEqual({ reason: GRANT_REQUIRES_OWNER_ID, message: GRANT_REQUIRES_OWNER_MESSAGE });
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
