import { describe, it, expect } from "vitest";
import { chainedHandoffPath, handoffReturnPath, signInLinkFor } from "./handoffReturn";

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

describe("[CHN6] chainedHandoffPath: /auth's next", () => {
  const offer = "/cmc-accept?capabilityUrl=https%3A%2F%2Fcap%40req.test%2F&scopeStreamId=s1&mode=popup&returnUrl=https%3A%2F%2Fapp.test";

  it("[CHN6a] resolves an exact hand-off route with its own query, dropping the access-request params", () => {
    const search = "?poll=https%3A%2F%2Fcore.test%2Freg%2Faccess%2Fk1&key=k1&next=" + encodeURIComponent(offer);
    expect(chainedHandoffPath(search)).toBe(offer);
    expect(chainedHandoffPath("?next=%2Fcmc-scope-update")).toBe("/cmc-scope-update");
    // a nested next and a fragment are dropped
    expect(chainedHandoffPath("?next=" + encodeURIComponent("/cmc-accept?a=1&next=/cmc-accept#frag"))).toBe("/cmc-accept?a=1");
  });

  it("[CHN6b] rejects anything but an exact hand-off route on this origin", () => {
    for (const next of [
      "/evil",
      "https://x",
      "https://x/cmc-accept",
      "//x/cmc-accept",
      "/\\x/cmc-accept",
      "/cmc-accept/../account/profile",
      "/cmc-accept/",
      "/cmc-accept-x?a=1",
      "cmc-accept",
      "javascript:alert(1)",
      "",
    ]) {
      expect(chainedHandoffPath("?next=" + encodeURIComponent(next)), next).toBeNull();
    }
    expect(chainedHandoffPath("?poll=x")).toBeNull();
  });
});
