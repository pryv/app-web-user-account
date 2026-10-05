import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkAppAccess,
  closeOrRedirect,
  closeOrFallback,
  CLOSE_CHECK_MS,
  loadAccessState,
  updateAccessState,
  buildAcceptedState,
  createHandoffSecret,
  updateAppAccess,
  type AccessState,
} from "./accessFlow";

/**
 * closeOrRedirect navigates to a query-supplied URL (`returnURL`). These guard against open-redirect / javascript:-scheme XSS
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
});

/**
 * After the decision, a pop-up opened by the app closes, but a tab the page did
 * not open (a phone reached by redirection) cannot be closed by script. A moment
 * later, a window still open goes back to the app when it is a tab with a way
 * back, and otherwise hands over to the caller (the "request complete" card).
 * A pop-up must never be navigated to the app (it would load inside the pop-up).
 * Observed: the navigation made (`location.replace`) and the callback, with fake
 * timers standing for the deferred check.
 */
describe("[CLBX] closeOrFallback: close, else go back from a tab", () => {
  let replaced: string | null;
  let onStillOpen: ReturnType<typeof vi.fn<() => void>>;
  let hrefSet: string | null;
  let win: {
    closed: boolean; opener: unknown; close: () => void; top: unknown; self: unknown;
    location: { replace: (u: string) => void; href: string };
  };

  function stubWindow ({ closes, opener, framed = false }: { closes: boolean; opener: unknown; framed?: boolean }) {
    win = {
      closed: false,
      opener,
      close: () => { if (closes) win.closed = true; },
      top: null,
      self: null,
      location: {
        replace: (u: string) => { replaced = u; },
        set href(v: string) { hrefSet = v; },
        get href() { return hrefSet ?? ""; },
      },
    };
    win.self = win;
    win.top = framed ? {} : win;
    vi.stubGlobal("window", win);
  }

  beforeEach(() => {
    replaced = null;
    hrefSet = null;
    onStillOpen = vi.fn<() => void>();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("[CLB1] a window that closes (pop-up or tab): no navigation, no callback", () => {
    for (const opener of [{}, null]) {
      stubWindow({ closes: true, opener });
      closeOrFallback({ backUrl: "https://app.test/back", onStillOpen });
      vi.advanceTimersByTime(CLOSE_CHECK_MS);
      expect(replaced, String(opener)).toBe(null);
      expect(onStillOpen, String(opener)).not.toHaveBeenCalled();
    }
  });

  it("[CLB2] a tab still open with a way back goes back to the app", () => {
    stubWindow({ closes: false, opener: null });
    closeOrFallback({ backUrl: "https://app.test/back", onStillOpen });
    expect(replaced).toBe(null); // not before the deferred check
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(replaced).toBe("https://app.test/back");
    expect(onStillOpen).not.toHaveBeenCalled();
  });

  it("[CLB3] a pop-up still open is never navigated: the callback fires", () => {
    stubWindow({ closes: false, opener: {} });
    closeOrFallback({ backUrl: "https://app.test/back", onStillOpen });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(replaced).toBe(null);
    expect(onStillOpen).toHaveBeenCalledTimes(1);
  });

  it("[CLB4] a tab still open without a (valid) way back: the callback fires", () => {
    for (const backUrl of [null, "javascript:alert(1)"]) {
      replaced = null;
      onStillOpen = vi.fn<() => void>();
      stubWindow({ closes: false, opener: null });
      closeOrFallback({ backUrl, onStillOpen });
      vi.advanceTimersByTime(CLOSE_CHECK_MS);
      expect(replaced, String(backUrl)).toBe(null);
      expect(onStillOpen, String(backUrl)).toHaveBeenCalledTimes(1);
    }
  });

  it("[CLB6] closeOrRedirect without a returnURL uses the fallback; with an http(s) returnURL it does not", () => {
    stubWindow({ closes: false, opener: null });
    closeOrRedirect("https://poll", { status: "REFUSED" } as AccessState, false, { backUrl: "https://app.test/back", onStillOpen });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(replaced).toBe("https://app.test/back");

    replaced = null;
    stubWindow({ closes: false, opener: null });
    closeOrRedirect("https://poll", { status: "REFUSED", returnURL: "https://app.test/cb" } as AccessState, false, { backUrl: "https://app.test/back", onStillOpen });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(hrefSet).toMatch(/^https:\/\/app\.test\/cb\?/);
    expect(replaced).toBe(null);
    expect(onStillOpen).not.toHaveBeenCalled();
  });

  it("[CLB7] a page shown in a frame is never navigated: the callback fires", () => {
    stubWindow({ closes: false, opener: null, framed: true });
    closeOrFallback({ backUrl: "https://app.test/back", onStillOpen });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(replaced).toBe(null);
    expect(onStillOpen).toHaveBeenCalledTimes(1);
  });

  it("[CLB8] a non-http(s) returnURL is not followed and falls back like no returnURL", () => {
    stubWindow({ closes: false, opener: null });
    closeOrRedirect("https://poll", { status: "REFUSED", returnURL: "javascript:alert(1)" } as AccessState, false, { backUrl: "https://app.test/back", onStillOpen });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(hrefSet).toBe(null);
    expect(replaced).toBe("https://app.test/back");
  });
});

/**
 * The return leg of an access request must not carry credentials: an ACCEPTED
 * state holds the token, the token-bearing apiEndpoint and the username, and
 * everything appended to returnURL lands in the calling page's address bar,
 * history and Referer. The caller reads only poll/key and fetches the rest.
 */
describe("[RURP] closeOrRedirect returnURL params", () => {
  let hrefSet: string;
  const pollUrl = "https://core.example/reg/access/KEY123";
  const accepted: AccessState = {
    status: "ACCEPTED",
    key: "KEY123",
    requestingAppId: "my-app",
    returnURL: "https://app.example/#/route?",
    lang: "en",
    expireAfter: 3600,
    token: "cktzv0mn80001qw3ktokenvalue",
    apiEndpoint: "https://cktzv0mn80001qw3ktokenvalue@core.example/alice/",
    username: "alice",
  };

  beforeEach(() => {
    hrefSet = "";
    vi.stubGlobal("window", {
      location: {
        set href(v: string) { hrefSet = v; },
        get href() { return hrefSet; },
      },
      close: () => {},
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never emits the token, apiEndpoint or username", () => {
    closeOrRedirect(pollUrl, accepted, false);
    expect(hrefSet).not.toContain("prYvtoken");
    expect(hrefSet).not.toContain("prYvapiEndpoint");
    expect(hrefSet).not.toContain("prYvusername");
    expect(hrefSet).not.toContain("cktzv0mn80001qw3ktokenvalue");
    expect(hrefSet).not.toContain("alice");
  });

  it("emits only poll, key and status, and keeps the poll URL intact", () => {
    closeOrRedirect(pollUrl, accepted, false);
    const emitted = [...hrefSet.matchAll(/[?&](prYv[^=]+)=/g)].map((m) => m[1]).sort();
    expect(emitted).toEqual(["prYvkey", "prYvpoll", "prYvstatus"]);
    expect(hrefSet).toContain("prYvpoll=" + encodeURIComponent(pollUrl));
    expect(hrefSet.startsWith("https://app.example/#/route?")).toBe(true);
  });

  it("omits allow-listed params absent from the state", () => {
    closeOrRedirect(pollUrl, { status: "REFUSED", returnURL: "https://app.example/cb" }, false);
    expect(hrefSet).toContain("prYvstatus=REFUSED");
    expect(hrefSet).not.toContain("prYvkey");
  });

  it("keeps the oauth2 branch free of prYv params and credentials", () => {
    closeOrRedirect(pollUrl, { ...accepted, oauthState: "opaque-state" }, false);
    expect(hrefSet).toContain("state=opaque-state");
    expect(hrefSet).toContain("code=KEY123");
    expect(hrefSet).not.toContain("prYv");
    expect(hrefSet).not.toContain("cktzv0mn80001qw3ktokenvalue");
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

  it("[AFC4] a failed check-app carries the HTTP status and the API error id", async () => {
    const req = { requestingAppId: "app", requestedPermissions: [] };
    stubFetch(401, { error: { id: "invalid-access-token", message: "x" } });
    await expect(checkAppAccess("https://alice.core.test/", "tok", req)).rejects.toMatchObject({ status: 401, id: "invalid-access-token" });
    const fn = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("not json");
      },
    }));
    vi.stubGlobal("fetch", fn);
    await expect(checkAppAccess("https://alice.core.test/", "tok", req)).rejects.toMatchObject({ status: 503, id: undefined });
  });
});

/**
 * [AFH] Credential hand-off accept shapes.
 *
 * The ACCEPTED payload is either inline (token) or hand-off (a one-time key),
 * never both — a token beside a hand-off would defeat the whole point.
 */
describe("[AFH] credential hand-off accept shapes", () => {
  const common = {
    username: "alice",
    endpoint: "https://alice.pryv.me/",
    token: "app-token-123",
    apiEndpointWithToken: "https://app-token-123@alice.pryv.me/",
  };

  it("[AFH1] shape H (handoffKey present) carries the key and a token-less endpoint, never the token", () => {
    const accepted = buildAcceptedState({ ...common, handoffKey: "evt.rand" });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.username).toBe("alice");
    expect(accepted.handoff).toEqual({ type: "shared-secret", key: "evt.rand" });
    expect(accepted.token).toBeUndefined();
    expect(accepted.apiEndpoint).toBe("https://alice.pryv.me/");
  });

  it("[AFH2] shape L (no handoffKey) carries the inline token, never a hand-off", () => {
    const accepted = buildAcceptedState({ ...common, handoffKey: null });
    expect(accepted.token).toBe("app-token-123");
    expect(accepted.apiEndpoint).toBe("https://app-token-123@alice.pryv.me/");
    expect(accepted.handoff).toBeUndefined();
    // Exclusivity: exactly one of token / handoff is ever set.
    expect((accepted.token == null) !== (accepted.handoff == null)).toBe(true);
  });

  it("[AFH3] the delegation hint rides at the top level of either shape", () => {
    const delegation = {
      isDelegatedAccess: true as const,
      controlledUsername: "kid",
      delegate: { username: "parent" },
    };
    const h = buildAcceptedState({ ...common, handoffKey: "evt.r", delegation });
    const l = buildAcceptedState({ ...common, handoffKey: null, delegation });
    expect(h.delegation).toEqual(delegation);
    expect(l.delegation).toEqual(delegation);
    expect(h.token).toBeUndefined();
    expect(l.handoff).toBeUndefined();
  });

  it("[AFH4] createHandoffSecret posts to the account's shared-secrets with the personal token and returns the key", async () => {
    let captured: { url: string; options: RequestInit } | null = null;
    const fn = vi.fn(async (url: string, options: RequestInit) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ sharedSecret: { key: "evt.the-key" } }) };
    });
    vi.stubGlobal("fetch", fn);
    try {
      const key = await createHandoffSecret("https://alice.pryv.me/", "personal-tok", {
        requestingAppId: "my-app",
        secret: { username: "alice", token: "app-token-123", apiEndpoint: "https://app-token-123@alice.pryv.me/" },
      });
      expect(key).toBe("evt.the-key");
      expect(captured!.url).toBe("https://alice.pryv.me/shared-secrets");
      expect((captured!.options.headers as Record<string, string>).Authorization).toBe("personal-tok");
      const body = JSON.parse(captured!.options.body as string);
      expect(body.title).toBe("access-handoff:my-app");
      expect(body.secret.token).toBe("app-token-123");
      expect(typeof body.ttl).toBe("number");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("[AFH5] createHandoffSecret throws on a non-ok response (caller falls back to inline)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    try {
      await expect(
        createHandoffSecret("https://alice.pryv.me/", "personal-tok", {
          requestingAppId: "my-app",
          secret: { username: "alice", token: "t", apiEndpoint: "https://t@alice.pryv.me/" },
        }),
      ).rejects.toThrow(/create shared secret failed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("[AFUP] updateAppAccess", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("[AFU1] PUTs the update to the access by id with the personal token, without display extras", async () => {
    let captured: { url: string; options: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        captured = { url, options };
        return { ok: true, json: async () => ({ access: { id: "a/1", token: "kept-token", type: "app", permissions: [] } }) };
      }),
    );
    const access = await updateAppAccess("https://alice.pryv.me/", "personal-tok", "a/1", {
      permissions: [
        { streamId: "diary", level: "read", defaultName: "Journal", name: "Journal" },
        { streamId: "weight", level: "contribute" },
      ],
      clientData: { k: "v" },
      deviceName: "phone",
      expireAfter: 60,
    });
    expect(access.token).toBe("kept-token");
    expect(captured!.url).toBe("https://alice.pryv.me/accesses/a%2F1");
    expect(captured!.options.method).toBe("PUT");
    expect((captured!.options.headers as Record<string, string>).Authorization).toBe("personal-tok");
    expect(JSON.parse(captured!.options.body as string)).toEqual({
      permissions: [
        { streamId: "diary", level: "read" },
        { streamId: "weight", level: "contribute" },
      ],
      clientData: { k: "v" },
      deviceName: "phone",
      expireAfter: 60,
    });
  });

  it("[AFU2] throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "forbidden" })));
    await expect(
      updateAppAccess("https://alice.pryv.me/", "personal-tok", "a1", { permissions: [] }),
    ).rejects.toThrow(/update access failed \(403\)/);
  });
});

/**
 * A granted request carrying a hand-off page (`next`, a consent offer)
 * continues to it in the same window instead of closing. Observed: the
 * `location.replace` made, `window.close` (not called), and the redirect
 * that wins over it.
 */
describe("[CHN] closeOrRedirect continues to the hand-off page", () => {
  const NEXT = "/cmc-accept?capabilityUrl=https%3A%2F%2Fcap%40req.test%2F&scopeStreamId=s1&mode=popup";
  let replaced: string | null;
  let hrefSet: string | null;
  let closed: boolean;
  let cliRendered: boolean;

  beforeEach(() => {
    replaced = null;
    hrefSet = null;
    closed = false;
    cliRendered = false;
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      closed: false,
      opener: {},
      close: () => { closed = true; },
      location: {
        replace: (u: string) => { replaced = u; },
        set href(v: string) { hrefSet = v; },
        get href() { return hrefSet ?? ""; },
      },
    });
    const root = { set innerHTML(_v: string) { cliRendered = true; } };
    vi.stubGlobal("document", { title: "", getElementById: () => root, body: root });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("[CHN1] without a returnURL it replaces the location with next and does not close", () => {
    for (const returnURL of [undefined, null, "false"]) {
      replaced = null;
      closed = false;
      closeOrRedirect("https://poll", { status: "ACCEPTED", returnURL } as AccessState, false, { backUrl: null, next: NEXT });
      vi.advanceTimersByTime(CLOSE_CHECK_MS);
      expect(replaced, String(returnURL)).toBe(NEXT);
      expect(closed, String(returnURL)).toBe(false);
      expect(hrefSet, String(returnURL)).toBe(null);
    }
  });

  it("[CHN3] a returnURL wins over next", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED", returnURL: "https://app.test/cb" } as AccessState, false, { backUrl: null, next: NEXT });
    expect(hrefSet).toMatch(/^https:\/\/app\.test\/cb\?/);
    expect(replaced).toBe(null);
  });

  it("[CHN4] CLI mode ignores next", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED" } as AccessState, true, { backUrl: null, next: NEXT });
    vi.advanceTimersByTime(CLOSE_CHECK_MS);
    expect(cliRendered).toBe(true);
    expect(replaced).toBe(null);
    expect(closed).toBe(false);
  });

  it("[CHN8] (guard) a next that is not a path on this origin is never followed: the window closes", () => {
    for (const next of ["https://evil.test/cmc-accept", "//evil.test/cmc-accept", "/\\evil.test", "javascript:alert(1)", ""]) {
      replaced = null;
      closed = false;
      closeOrRedirect("https://poll", { status: "ACCEPTED" } as AccessState, false, { backUrl: null, next });
      vi.advanceTimersByTime(CLOSE_CHECK_MS);
      expect(replaced, next).toBe(null);
      expect(closed, next).toBe(true);
    }
  });

  it("[CHN9] without next the window closes as before", () => {
    closeOrRedirect("https://poll", { status: "ACCEPTED" } as AccessState, false, { backUrl: null, next: null });
    expect(closed).toBe(true);
    expect(replaced).toBe(null);
  });
});
