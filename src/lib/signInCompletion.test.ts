import { describe, it, expect } from "vitest";

/**
 * [SICT] The one completion decision every sign-in path shares.
 *
 * Password, second factor and third-party sign-in used to each re-implement
 * this; these pin the order (returnURL, then a hand-off `next`, then the
 * profile) so they cannot drift apart again.
 */

import { signedInTarget } from "./signInCompletion";

const ENDPOINT = "https://alice.core.example";
const SI = "https://core.example/reg/service/info";

describe("[SICT] signed-in target", () => {
  it("[SICT1] hands control back to the calling app when returnURL is present", () => {
    const target = signedInTarget(
      "?returnURL=https%3A%2F%2Fapp.example%2Fcb&state=csrf-1",
      ENDPOINT,
    );
    expect(target.kind).toBe("external");
    const url = new URL((target as { href: string }).href);
    expect(url.origin + url.pathname).toBe("https://app.example/cb");
    expect(url.searchParams.get("state")).toBe("csrf-1");
    expect(url.searchParams.get("pryvApiEndpoint")).toBe(ENDPOINT);
  });

  it("[SICT2] returns to a hand-off page with the query it carried", () => {
    const target = signedInTarget(
      "?next=%2Fcmc-accept&capabilityUrl=https%3A%2F%2Fcore%2Fcap&mode=popup",
      ENDPOINT,
    );
    expect(target).toEqual({
      kind: "internal",
      path: "/cmc-accept?capabilityUrl=https%3A%2F%2Fcore%2Fcap&mode=popup",
    });
  });

  it("[SICT3] otherwise the profile, keeping pryvServiceInfoUrl", () => {
    expect(signedInTarget(`?pryvServiceInfoUrl=${encodeURIComponent(SI)}`, ENDPOINT)).toEqual({
      kind: "internal",
      path: "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(SI),
    });
    expect(signedInTarget("", ENDPOINT)).toEqual({
      kind: "internal",
      path: "/account/profile",
    });
  });

  it("[SICT4] returnURL takes precedence over a hand-off next", () => {
    const target = signedInTarget(
      "?returnURL=https%3A%2F%2Fapp.example%2Fcb&next=%2Fcmc-accept",
      ENDPOINT,
    );
    expect(target.kind).toBe("external");
  });

  it("[SICT5] refuses a returnURL that is not an absolute http(s) URL", () => {
    expect(() => signedInTarget("?returnURL=javascript%3Aalert(1)", ENDPOINT)).toThrow();
  });

  it("[SICT6] a pending access request goes back to /auth, before returnURL", () => {
    const poll = "https://core.example/reg/access/KEY1";
    const target = signedInTarget(
      `?poll=${encodeURIComponent(poll)}&key=KEY1&returnURL=https%3A%2F%2Fapp.example%2Fcb` +
        `&pryvServiceInfoUrl=${encodeURIComponent(SI)}`,
      ENDPOINT,
    );
    expect(target.kind).toBe("internal");
    const path = (target as { path: string }).path;
    expect(path.startsWith("/auth?")).toBe(true);
    const p = new URLSearchParams(path.slice("/auth".length));
    expect(p.get("poll")).toBe(poll);
    expect(p.get("pryvServiceInfoUrl")).toBe(SI);
  });

  it("[SICT7] returns a bounced visitor to the account page it asked for", () => {
    expect(
      signedInTarget("?returnTo=%2Faccount%2Fsecurity%3FbackLabel%3DApp", ENDPOINT),
    ).toEqual({ kind: "internal", path: "/account/security?backLabel=App" });
  });

  it("[SICT8] returnTo loses to returnURL and wins over a hand-off next", () => {
    expect(
      signedInTarget("?returnURL=https%3A%2F%2Fapp.example%2Fcb&returnTo=%2Faccount%2Fapps", ENDPOINT).kind,
    ).toBe("external");
    expect(signedInTarget("?returnTo=%2Faccount%2Fapps&next=%2Fcmc-accept", ENDPOINT)).toEqual({
      kind: "internal",
      path: "/account/apps",
    });
  });

  it("[SICT11] returnTo keeps the platform the user signed in to", () => {
    const other = "https://other.example/reg/service/info";
    const target = signedInTarget(
      `?pryvServiceInfoUrl=${encodeURIComponent(SI)}&returnTo=` +
        encodeURIComponent(`/account/apps?pryvServiceInfoUrl=${encodeURIComponent(other)}`),
      ENDPOINT,
    ) as { path: string };
    const p = new URLSearchParams(target.path.slice(target.path.indexOf("?")));
    expect(target.path.startsWith("/account/apps?")).toBe(true);
    expect(p.get("pryvServiceInfoUrl")).toBe(SI);
  });

  it("[SICT9] an unsafe returnTo falls through to the profile", () => {
    expect(signedInTarget("?returnTo=https%3A%2F%2Fevil.test", ENDPOINT)).toEqual({
      kind: "internal",
      path: "/account/profile",
    });
  });

  it("[SICT10] the profile fallback keeps backUrl and backLabel", () => {
    const target = signedInTarget(
      `?pryvServiceInfoUrl=${encodeURIComponent(SI)}&backUrl=https%3A%2F%2Fapp.test&backLabel=App`,
      ENDPOINT,
    ) as { path: string };
    const p = new URLSearchParams(target.path.slice(target.path.indexOf("?")));
    expect(target.path.startsWith("/account/profile?")).toBe(true);
    expect(p.get("backUrl")).toBe("https://app.test");
    expect(p.get("backLabel")).toBe("App");
    expect(p.get("pryvServiceInfoUrl")).toBe(SI);
  });
});
