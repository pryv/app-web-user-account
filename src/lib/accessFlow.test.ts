import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeOrRedirect, type AccessState } from "./accessFlow";

/**
 * closeOrRedirect navigates to query-supplied URLs (`returnURL`,
 * `redirectUrl`). These guard against open-redirect / javascript:-scheme XSS
 * in the auth origin — a non-http(s) scheme must never reach
 * `window.location.href`.
 */
describe("closeOrRedirect redirect-target scheme guard", () => {
  let hrefSet: string | null;
  let closed: boolean;

  beforeEach(() => {
    hrefSet = null;
    closed = false;
    vi.stubGlobal("window", {
      location: {
        set href(v: string) { hrefSet = v; },
        get href() { return hrefSet ?? ""; },
      },
      close: () => { closed = true; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does NOT navigate to a javascript: returnURL (closes instead)", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED", returnURL: "javascript:alert(document.domain)" } as AccessState, false);
    expect(hrefSet).toBe(null);
    expect(closed).toBe(true);
  });

  it("does NOT navigate to a data: returnURL", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED", returnURL: "data:text/html,<script>1</script>" } as AccessState, false);
    expect(hrefSet).toBe(null);
    expect(closed).toBe(true);
  });

  it("navigates to a valid http(s) returnURL", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED", returnURL: "https://app.test/cb" } as AccessState, false);
    expect(hrefSet).toMatch(/^https:\/\/app\.test\/cb\?/);
  });

  it("fails closed on a javascript: REDIRECTED redirectUrl (does not follow it)", () => {
    closeOrRedirect(
      "https://poll",
      { status: "REDIRECTED", redirectUrl: "javascript:alert(1)", returnURL: "false" } as AccessState,
      false,
    );
    expect(hrefSet).toBe(null); // bad redirectUrl not followed; returnURL 'false' → close
    expect(closed).toBe(true);
  });

  it("follows a valid http(s) REDIRECTED redirectUrl", () => {
    closeOrRedirect("https://poll", { status: "REDIRECTED", redirectUrl: "https://core2.pryv.me/handoff" } as AccessState, false);
    expect(hrefSet).toBe("https://core2.pryv.me/handoff");
  });
});
