// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CLAIM_STORAGE_KEY,
  clearStoredClaim,
  isDefinitiveRefusal,
  readStoredClaim,
  runTransferClaim,
  searchWithoutLink,
  storeClaim,
  transferClaim,
  transferDecline,
  transferErrorMessage,
  transferLinkFrom,
} from "./accountTransfer";
import { ApiCallError } from "./emailVerification";
import { DelegationError } from "./pryvClient";

/**
 * [ATRF] Account transfer, the beneficiary's side: the link read and kept out
 * of the URL, the public claim / decline calls, the claim sequence and the
 * refusals in plain words.
 */

type Reply = { ok: boolean; status: number; body: unknown };

/** Stub fetch with a queue of replies; returns the mock for call inspection. */
function stubFetch(...replies: Reply[]) {
  const mock = vi.fn(async (_url: string, _init: { body: string }) => {
    const r = replies.shift() ?? { ok: true, status: 200, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const ok = (body: unknown): Reply => ({ ok: true, status: 200, body });
const refused = (status: number, id: string): Reply => ({
  ok: false,
  status,
  body: { error: { id, message: "raw server sentence" } },
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("[ATRF] account transfer", () => {
  it("[ATR01] the link: a username-shaped owner and a token, both required", () => {
    expect(transferLinkFrom("?username=Carol&token=T1&pryvServiceInfoUrl=x")).toEqual({ owner: "carol", token: "T1" });
    expect(transferLinkFrom("?username=carol")).toBeNull();
    expect(transferLinkFrom("?token=T1")).toBeNull();
    expect(transferLinkFrom("?username=%3Cb%3Ehi%3C%2Fb%3E&token=T1")).toBeNull();
    expect(searchWithoutLink("?username=carol&token=T1&pryvServiceInfoUrl=x")).toBe("?pryvServiceInfoUrl=x");
    expect(searchWithoutLink("?username=carol&token=T1")).toBe("");
  });

  it("[ATR02] the stored claim survives the tab, is validated, and is cleared", () => {
    expect(readStoredClaim()).toBeNull();
    storeClaim({ owner: "carol", token: "T1" });
    expect(readStoredClaim()).toEqual({ owner: "carol", token: "T1" });
    sessionStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify({ owner: "<b>", token: "T" }));
    expect(readStoredClaim()).toBeNull();
    sessionStorage.setItem(CLAIM_STORAGE_KEY, "not json");
    expect(readStoredClaim()).toBeNull();
    storeClaim({ owner: "carol", token: "T1" });
    clearStoredClaim();
    expect(sessionStorage.getItem(CLAIM_STORAGE_KEY)).toBeNull();
  });

  it("[ATR03] claim and decline post to the owner's core with the appId and token", async () => {
    const mock = stubFetch(ok({ transfer: { status: "invited", username: "carol" } }), ok({ declined: true }));
    expect(await transferClaim("https://carol.core.test/", "app", "T1", "alice")).toBe("invited");
    expect(mock.mock.calls[0][0]).toBe("https://carol.core.test/account/auto-deletion/transfer-claim");
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ appId: "app", token: "T1", claimant: "alice" });
    await transferDecline("https://carol.core.test/", "app", "T1");
    expect(mock.mock.calls[1][0]).toBe("https://carol.core.test/account/auto-deletion/transfer-decline");
    expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({ appId: "app", token: "T1" });
  });

  it("[ATR04] the sequence: claim, accept on the claimant's core, claim again", async () => {
    const mock = stubFetch(
      ok({ transfer: { status: "invited", username: "carol" } }),
      ok({ transfer: { status: "completed", username: "carol" } }),
    );
    const acceptAttach = vi.fn().mockResolvedValue({});
    const steps: string[] = [];
    const outcome = await runTransferClaim({
      ownerApiEndpoint: "https://carol.core.test/",
      appId: "app",
      link: { owner: "carol", token: "T1" },
      claimant: "alice",
      acceptAttach,
      onStep: (s) => steps.push(s),
    });
    expect(acceptAttach).toHaveBeenCalledWith("carol");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(steps).toEqual(["claim", "accept", "complete"]);
    expect(outcome).toBe("completed");
  });

  it("[ATR09] a second claim still invited: the acceptance is recorded, nothing to retry", async () => {
    stubFetch(
      ok({ transfer: { status: "invited", username: "carol" } }),
      ok({ transfer: { status: "invited", username: "carol" } }),
    );
    const outcome = await runTransferClaim({
      ownerApiEndpoint: "https://carol.core.test/",
      appId: "app",
      link: { owner: "carol", token: "T1" },
      claimant: "alice",
      acceptAttach: vi.fn().mockResolvedValue({}),
    });
    expect(outcome).toBe("accepted");
  });

  it("[ATR10] refusals by reason, delegation off, and a failure that never reached the platform", async () => {
    stubFetch({
      ok: false,
      status: 400,
      body: { error: { id: "auto-deletion-transfer-invalid", message: "raw server sentence", data: { reason: "stale-relationship" } } },
    });
    const stale = await transferClaim("https://carol.core.test/", "app", "T1", "alice").catch((e: unknown) => e);
    expect(transferErrorMessage(stale)).toMatch(/earlier delegation between the two accounts must first be removed/);
    expect(isDefinitiveRefusal(stale)).toBe(false);
    stubFetch(refused(400, "unavailable-method"));
    const off = await transferClaim("https://carol.core.test/", "app", "T1", "alice").catch((e: unknown) => e);
    expect(transferErrorMessage(off)).toBe("Taking over an account is not available on this platform at the moment.");
    // The same id raised by the claimant's own core, through the delegation client.
    expect(transferErrorMessage(new DelegationError("raw", "unavailable-method"))).toMatch(/not available on this platform/);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const offline = await transferClaim("https://carol.core.test/", "app", "T1", "alice").catch((e: unknown) => e);
    expect(transferErrorMessage(offline)).toBe("Could not reach the platform. Check your connection, then try again.");
  });

  it("[ATR05] a first claim already completed stops there", async () => {
    const mock = stubFetch(ok({ transfer: { status: "completed", username: "carol" } }));
    const acceptAttach = vi.fn();
    await runTransferClaim({
      ownerApiEndpoint: "https://carol.core.test/",
      appId: "app",
      link: { owner: "carol", token: "T1" },
      claimant: "alice",
      acceptAttach,
    });
    expect(acceptAttach).not.toHaveBeenCalled();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("[ATR06] a failed acceptance stops before the second claim", async () => {
    const mock = stubFetch(ok({ transfer: { status: "invited", username: "carol" } }));
    const failure = new DelegationError("nope", "delegation-unknown-username");
    const err = await runTransferClaim({
      ownerApiEndpoint: "https://carol.core.test/",
      appId: "app",
      link: { owner: "carol", token: "T1" },
      claimant: "alice",
      acceptAttach: () => Promise.reject(failure),
    }).catch((e: unknown) => e);
    expect(err).toBe(failure);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(transferErrorMessage(err)).toBe("No account was found with that username.");
    expect(isDefinitiveRefusal(err)).toBe(false);
  });

  it("[ATR07] refusals in plain words, never the server's sentence; definitive ones are told apart", async () => {
    const cases: Array<[number, string, RegExp, boolean]> = [
      [403, "auto-deletion-transfer-invalid-link", /not valid/, true],
      [410, "auto-deletion-transfer-expired", /has passed/, true],
      [409, "auto-deletion-transfer-claimed", /Another account/, true],
      [429, "too-many-attempts", /Wait a moment/, false],
    ];
    for (const [status, id, message, definitive] of cases) {
      stubFetch(refused(status, id));
      const err = await transferClaim("https://carol.core.test/", "app", "T1", "alice").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiCallError);
      expect(transferErrorMessage(err)).toMatch(message);
      expect(transferErrorMessage(err)).not.toContain("raw server sentence");
      expect(isDefinitiveRefusal(err)).toBe(definitive);
    }
    stubFetch(refused(400, "something-else"));
    const other = await transferDecline("https://carol.core.test/", "app", "T1").catch((e: unknown) => e);
    expect(transferErrorMessage(other)).toBe("raw server sentence");
  });

  it("[ATR08] an answer without the expected shape is a failure", async () => {
    stubFetch(ok({ transfer: { status: "weird" } }), ok({}));
    await expect(transferClaim("https://carol.core.test/", "app", "T1", "alice")).rejects.toBeInstanceOf(ApiCallError);
    await expect(transferDecline("https://carol.core.test/", "app", "T1")).rejects.toBeInstanceOf(ApiCallError);
  });
});
