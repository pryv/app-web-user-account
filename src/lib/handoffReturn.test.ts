import { describe, it, expect } from "vitest";
import { handoffReturnPath, signInLinkFor } from "./handoffReturn";

describe("signInLinkFor / handoffReturnPath", () => {
  it("round-trips a hand-off page with its query string", () => {
    const search = "?pryvServiceInfoUrl=https%3A%2F%2Fcore%2Freg%2Fservice%2Finfo&scopeRequestEventId=abc&mode=popup";
    const link = signInLinkFor("/cmc-scope-update", search);
    expect(link.startsWith("/signin?")).toBe(true);
    const back = handoffReturnPath(link.slice("/signin".length));
    expect(back).toBe("/cmc-scope-update?pryvServiceInfoUrl=https%3A%2F%2Fcore%2Freg%2Fservice%2Finfo&scopeRequestEventId=abc&mode=popup");
  });

  it("accepts only the exact hand-off routes", () => {
    expect(handoffReturnPath("?next=/cmc-accept&capabilityUrl=x")).toBe("/cmc-accept?capabilityUrl=x");
    for (const next of [
      "https://evil.example/cmc-accept",
      "//evil.example",
      "/cmc-accept/../account",
      "/cmc-accept-x",
      "/account/profile",
      "javascript:alert(1)",
      "",
    ]) {
      expect(handoffReturnPath(`?next=${encodeURIComponent(next)}`)).toBeNull();
    }
    expect(handoffReturnPath("?pryvServiceInfoUrl=x")).toBeNull();
  });
});
