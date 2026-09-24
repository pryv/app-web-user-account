// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * [SRTP] The sign-in bounce: which page a signed-out visitor returns to, and
 * which entry-link params survive the trip.
 */

vi.mock("pryv", () => ({ default: { Service: class {}, Connection: class {} } }));

import { safeReturnTo, signinPath, accountPath } from "./session";

const SI = "https://core.test/reg/service/info";

function queryOf(path: string): URLSearchParams {
  const i = path.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : path.slice(i));
}

describe("[SRTP] safeReturnTo", () => {
  it("[SRT1] accepts account pages and change-password, with their query", () => {
    expect(safeReturnTo("/account/security?backLabel=X")).toBe("/account/security?backLabel=X");
    expect(safeReturnTo("/change-password")).toBe("/change-password");
  });

  it("[SRT2] rejects anything that is not a same-origin account path", () => {
    for (const raw of [
      null,
      "",
      "//evil.test/account/x",
      "/\\evil.test",
      "javascript:alert(1)",
      "https://evil.test/account/x",
      "account/security",
      "/signin",
      "/signin?returnTo=%2Faccount%2Fx",
      "/cmc-accept?capabilityUrl=https%3A%2F%2Fcore%2Fcap",
      "/auth?poll=x",
      "/accountx",
      "/change-password-now",
    ]) {
      expect(safeReturnTo(raw)).toBeNull();
    }
  });

  it("[SRT3] normalises dot segments before checking the prefix", () => {
    expect(safeReturnTo("/account/../cmc-accept?capabilityUrl=x")).toBeNull();
  });
});

describe("[SRTP] signinPath / accountPath", () => {
  beforeEach(() => localStorage.clear());

  it("[SRT4] carries the platform, the hand-off params and a validated returnTo", () => {
    const path = signinPath(
      `?pryvServiceInfoUrl=${encodeURIComponent(SI)}&backUrl=https%3A%2F%2Fapp.test&backLabel=App&username=alice&other=1`,
      "/account/security?backLabel=App",
    );
    const q = queryOf(path);
    expect(path.startsWith("/signin?")).toBe(true);
    expect(q.get("pryvServiceInfoUrl")).toBe(SI);
    expect(q.get("backUrl")).toBe("https://app.test");
    expect(q.get("backLabel")).toBe("App");
    expect(q.get("username")).toBe("alice");
    expect(q.get("returnTo")).toBe("/account/security?backLabel=App");
    expect(q.get("other")).toBeNull();
  });

  it("[SRT5] drops an unsafe returnTo, keeps an existing one on a re-bounce", () => {
    expect(queryOf(signinPath("", "https://evil.test")).get("returnTo")).toBeNull();
    expect(queryOf(signinPath("?returnTo=%2Faccount%2Fapps")).get("returnTo")).toBe("/account/apps");
  });

  it("[SRT6] stays bare without anything to carry", () => {
    expect(signinPath()).toBe("/signin");
  });

  it("[SRT7] accountPath keeps the platform and the hand-off params only", () => {
    const path = accountPath("/account/profile", "?backLabel=App&returnTo=%2Faccount%2Fx", SI);
    const q = queryOf(path);
    expect(path.startsWith("/account/profile?")).toBe(true);
    expect(q.get("pryvServiceInfoUrl")).toBe(SI);
    expect(q.get("backLabel")).toBe("App");
    expect(q.get("returnTo")).toBeNull();
    expect(accountPath("/account/profile", "", null)).toBe("/account/profile");
  });
});
