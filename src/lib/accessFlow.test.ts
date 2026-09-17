import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  closeOrRedirect,
  loadAccessState,
  updateAccessState,
  type AccessState,
} from "./accessFlow";

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

/**
 * The consent form on the poll, and what the register's answer to an
 * ACCEPTED post carries when it refuses the grant. The distinction between
 * "this grant is wrong" and "I could not check" decides whether the page
 * destroys the access it just minted, so it is pinned here.
 */
describe("consent form + accept-result shaping", () => {
  const POLL = "https://core.test/reg/access/key1";

  function stubFetch(status: number, body: unknown) {
    const fn = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("[AFC1] reads a poll body that carries a consent form, and one that does not", async () => {
    stubFetch(201, {
      status: "NEED_SIGNIN",
      requestedPermissions: [{ streamId: "diary", level: "read" }],
      consent: {
        allowUserChoice: true,
        permissions: [
          { streamId: "diary", level: "read", mandatory: true },
          { streamId: "weight", level: "read", optIn: true },
        ],
      },
    });
    const withForm = await loadAccessState(POLL);
    expect(withForm.consent?.allowUserChoice).toBe(true);
    expect(withForm.consent?.permissions).toHaveLength(2);

    stubFetch(201, {
      status: "NEED_SIGNIN",
      requestedPermissions: [{ streamId: "diary", level: "read" }],
    });
    const without = await loadAccessState(POLL);
    // Absent, not null: an un-annotated request behaves exactly as before.
    expect(without.consent).toBeUndefined();
  });

  it("[AFC2] surfaces the refusal reason, and tells a bad grant from an unavailable check", async () => {
    stubFetch(400, {
      error: {
        id: "invalid-consent-grant",
        data: { reason: "mandatory-refused", offending: [{ streamId: "diary", level: "read" }] },
      },
    });
    const refused = await updateAccessState(POLL, { status: "ACCEPTED" });
    expect(refused.status).toBe(400);
    expect(refused.errorId).toBe("invalid-consent-grant");
    expect(refused.reason).toBe("mandatory-refused");

    stubFetch(503, {
      error: { id: "consent-check-unavailable", data: { reason: "core-unreachable" } },
    });
    const unavailable = await updateAccessState(POLL, { status: "ACCEPTED" });
    expect(unavailable.status).toBe(503);
    expect(unavailable.errorId).toBe("consent-check-unavailable");
  });

  it("[AFC3] a success, or an error body that is not JSON, carries no reason", async () => {
    stubFetch(200, { status: "ACCEPTED" });
    expect(await updateAccessState(POLL, { status: "ACCEPTED" })).toEqual({ status: 200 });

    const fn = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }));
    vi.stubGlobal("fetch", fn);
    expect(await updateAccessState(POLL, { status: "ACCEPTED" })).toEqual({ status: 502 });
  });
});
