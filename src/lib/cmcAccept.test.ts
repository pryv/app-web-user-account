import { describe, it, expect } from "vitest";
import Pryv from "pryv";
import { CmcError, errorIds } from "@pryv/cmc";
import { inviteFailure } from "./cmcAccept";
import { platformError } from "./apiError";
import { GRANT_REQUIRES_OWNER_ID, GRANT_REQUIRES_OWNER_MESSAGE } from "./delegation";

const cmcError = (id: string) => new CmcError("CMC accept failed: " + id, id);

/** What `Connection.apiOne` throws for an API refusal: its message embeds the call's params. */
function apiRefusal(apiError: Record<string, unknown>): Error {
  return new Pryv.PryvError(
    "Error for api method: \"events.create\" with params: {\"content\":{\"capabilityUrl\":\"https://secret-token@core.example/\"}} >> Result: {...}",
    apiError,
  );
}

describe("[CMAF] inviteFailure", () => {
  it("explains each capability outcome and hands its id back to the app", () => {
    const cases: Array<[string, RegExp, string]> = [
      [errorIds.CAPABILITY_INVALID, /not valid/, "danger"],
      [errorIds.CAPABILITY_CONSUMED, /already been used/, "info"],
      [errorIds.CAPABILITY_INVALIDATED, /withdrawn/, "danger"],
      [errorIds.CAPABILITY_ALREADY_ACCEPTED_BY_YOU, /already approved/, "info"],
      [errorIds.CAPABILITY_TIMEOUT, /still processing/, "info"],
    ];
    for (const [id, text, tone] of cases) {
      const f = inviteFailure(cmcError(id), "Could not approve.");
      expect(f.reason).toBe(id);
      expect(f.message).toMatch(text);
      expect(f.message).not.toContain(id);
      expect(f.tone).toBe(tone);
    }
  });

  it("explains a grant refused to a token obtained through a delegation", () => {
    const e = apiRefusal({ id: "invalid-operation", message: "not allowed", data: { id: GRANT_REQUIRES_OWNER_ID } });
    expect(inviteFailure(e, "Could not approve.")).toEqual({
      reason: GRANT_REQUIRES_OWNER_ID,
      message: GRANT_REQUIRES_OWNER_MESSAGE,
      tone: "danger",
    });
  });

  it("hands back the API error id and message, never the wrapper that embeds the params", () => {
    const e = apiRefusal({
      id: "invalid-operation",
      message: "Accepting requires a personal token.",
      data: { id: "cmc-accept-requires-personal-token" },
    });
    const f = inviteFailure(e, "Could not approve.");
    expect(f).toEqual({ reason: "cmc-accept-requires-personal-token", message: "Accepting requires a personal token.", tone: "danger" });
    expect(JSON.stringify(f)).not.toContain("secret-token");
  });

  it("keeps an unknown id as the reason and shows the error's own message", () => {
    expect(inviteFailure(cmcError("cmc-handler-threw"), "Could not approve.")).toEqual({
      reason: "cmc-handler-threw",
      message: "CMC accept failed: cmc-handler-threw",
      tone: "danger",
    });
  });

  it("falls back to the message, then to the fallback, when there is no id", () => {
    expect(inviteFailure(new Error("network down"), "Could not approve.")).toEqual({ reason: "network down", message: "network down", tone: "danger" });
    expect(inviteFailure("boom", "Could not decline.")).toEqual({ reason: "Could not decline.", message: "Could not decline.", tone: "danger" });
  });
});

describe("[APIE] platformError", () => {
  it("prefers a plugin id under data.id, then the API id, then the error's own id", () => {
    expect(platformError(apiRefusal({ id: "invalid-operation", message: "m", data: { id: "x-specific" } }), "f").id).toBe("x-specific");
    expect(platformError(apiRefusal({ id: "forbidden", message: "m" }), "f").id).toBe("forbidden");
    expect(platformError(cmcError("cmc-capability-invalid"), "f").id).toBe("cmc-capability-invalid");
    expect(platformError(new Error("x"), "f").id).toBeNull();
  });

  it("uses the fallback when the API error has no message, not the params-bearing wrapper", () => {
    expect(platformError(apiRefusal({ id: "forbidden" }), "Could not approve.")).toEqual({ id: "forbidden", message: "Could not approve." });
  });
});
