// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * The address of a consent screen's accounts, followed until it is verified.
 * Pinned here: the state read from each `account.get` shape, the add and the
 * resend, the poll (only while visible, stopped on unmount), the refusals, and
 * the answers of an account that left the page.
 */

const PLACEHOLDER = "a1b2c3d4e5f6g7h8i9j0@pryv.io";
const ALICE = "https://tok@alice.core.test/";
const BOB = "https://tok@bob.core.test/";

const net = vi.hoisted(() => ({
  /** Every call, as "<method>" or the emails operation, in order. */
  calls: [] as string[],
  answer: (async () => ({})) as (endpoint: string, method: string, params: { update?: Record<string, unknown> }) => Promise<unknown>,
}));
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
      }
      async apiOne(method: string, params: { update?: Record<string, unknown> }) {
        const emails = params.update?.emails;
        net.calls.push(emails != null ? JSON.stringify(emails) : method);
        return net.answer(this.apiEndpoint, method, params);
      }
    },
  },
}));

import { PROOF_POLL_MS, SEND_AGAIN_AFTER_MS, useVerifiedEmail, type EmailRequest } from "./useVerifiedEmail";
import type { ServiceInfoFeatures } from "./emailVerification";

const CAN_MAIL: ServiceInfoFeatures = { features: { emailVerification: { atRegistration: false, onAccount: true } } };
const GATED: ServiceInfoFeatures = { features: { emailVerification: { atRegistration: true, onAccount: true } } };
const NO_MAIL: ServiceInfoFeatures = {};

const entry = (value: string, primary: boolean, method: string | null, status = "verified") => ({
  value, primary, status, verifiedAt: null, verificationMethod: method,
});
const pending = (value: string) => entry(value, false, null, "pending");
const account = (...emails: Array<ReturnType<typeof entry> & { verificationCooldownUntil?: unknown }>) => ({
  email: emails.find((e) => e.primary)?.value ?? null,
  emails,
});
const apiError = (id: string, data: Record<string, unknown> = {}, message = "refused") =>
  Object.assign(new Error("API error"), { innerObject: { id, message, data } });

function hook(requests: EmailRequest[] = [{ endpoint: ALICE, required: true }], info: ServiceInfoFeatures | null = CAN_MAIL) {
  return renderHook(
    (props: { requests: EmailRequest[]; info: ServiceInfoFeatures | null }) =>
      useVerifiedEmail(props.requests, props.info, "test"),
    { initialProps: { requests, info } },
  );
}

/** Let pending answers through, `ms` later. */
const pass = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
}

const reads = () => net.calls.filter((c) => c === "account.get").length;

describe("useVerifiedEmail", () => {
  let held: unknown;
  beforeEach(() => {
    vi.useFakeTimers();
    net.calls = [];
    held = account(entry("alice@example.com", true, "registration"));
    net.answer = async () => held;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    setVisibility("visible");
  });

  it("[RVEN] checking, then proved, unproved or missing from the account", async () => {
    const cases: Array<[unknown, object]> = [
      [account(entry("alice@example.com", true, "email-link")), { kind: "proved", email: "alice@example.com" }],
      [account(entry("alice@example.com", true, "email-code")), { kind: "proved" }],
      [account(entry("alice@example.com", true, "operator")), { kind: "proved" }],
      // Verified by registration or before proofs existed: not proved.
      [account(entry("alice@example.com", true, "registration")), { kind: "unproved", email: "alice@example.com" }],
      [account(entry("alice@example.com", true, null)), { kind: "unproved" }],
      [account(entry("alice@example.com", true, null, "pending")), { kind: "unproved" }],
      // An older core lists no addresses.
      [{ email: "alice@example.com" }, { kind: "unproved", email: "alice@example.com" }],
      // Another address being proved does not make the primary one proved.
      [account(entry("alice@example.com", true, null), entry("other@example.com", false, "email-link")), { kind: "unproved" }],
      [account(entry(PLACEHOLDER, true, "registration")), { kind: "missing", suggested: null }],
      [{ email: null, emails: [] }, { kind: "missing" }],
      [null, { kind: "missing" }],
      [
        account(entry(PLACEHOLDER, true, "registration"), pending("later@example.com"), entry("ok@example.com", false, "email-link")),
        { kind: "missing", suggested: "ok@example.com" },
      ],
    ];
    for (const [value, expected] of cases) {
      held = value;
      const { result, unmount } = hook();
      expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "checking" });
      expect(result.current.proved(ALICE)).toBe(false);
      await pass();
      expect(result.current.stateOf(ALICE, true)).toMatchObject(expected);
      unmount();
    }
    // One read each, nothing written.
    expect(net.calls).toEqual(cases.map(() => "account.get"));
  });

  it("nothing is said until the platform's information is known, but a proof", async () => {
    const { result, rerender } = hook(undefined, null);
    await pass();
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "checking" });
    rerender({ requests: [{ endpoint: ALICE, required: true }], info: CAN_MAIL });
    expect(result.current.stateOf(ALICE, true).kind).toBe("unproved");
  });

  it("[RVQ3] an address added: waited for, seen verified by the poll, made primary, the placeholder removed", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook();
    await pass();
    net.answer = async (_e, method, params) => {
      if (method === "account.update") {
        const ops = params.update!.emails as { add?: string[]; setPrimary?: string; remove?: string[] };
        if (ops.add) held = account(entry(PLACEHOLDER, true, "registration"), pending(ops.add[0]));
        if (ops.setPrimary) held = account(entry(ops.setPrimary, true, "email-link"), entry(PLACEHOLDER, false, "registration"));
        if (ops.remove) held = account(entry("alice@example.com", true, "email-link"));
      }
      return held;
    };
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    expect(result.current.stateOf(ALICE, true)).toEqual({
      kind: "waiting", email: "alice@example.com", viaAdd: true, canSendAgain: false,
    });
    await pass(PROOF_POLL_MS * 2);
    expect(reads()).toBe(3);
    expect(result.current.stateOf(ALICE, true).kind).toBe("waiting");
    // Verified on another device.
    held = account(entry(PLACEHOLDER, true, "registration"), entry("alice@example.com", false, "email-link"));
    await pass(PROOF_POLL_MS);
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "proved", email: "alice@example.com", here: true });
    expect(net.calls.filter((c) => c !== "account.get")).toEqual([
      '{"add":["alice@example.com"]}',
      '{"setPrimary":"alice@example.com"}',
      JSON.stringify({ remove: [PLACEHOLDER] }),
    ]);
    // Proved: no more polling.
    const before = net.calls.length;
    await pass(PROOF_POLL_MS * 5);
    expect(net.calls).toHaveLength(before);
  });

  it("an address verified already is made primary at once; a placeholder that cannot be removed changes nothing", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"), entry("ok@example.com", false, "email-link"));
    const { result } = hook();
    await pass();
    net.answer = async (_e, _m, params) => {
      const ops = params.update?.emails as { setPrimary?: string; remove?: string[] };
      if (ops?.remove) throw apiError("invalid-operation");
      return account(entry("ok@example.com", true, "email-link"));
    };
    // Already verified on this account: made primary, not added again.
    await act(async () => result.current.add(ALICE, "OK@example.com"));
    expect(result.current.stateOf(ALICE, true).kind).toBe("proved");
    expect(net.calls.slice(1)).toEqual(['{"setPrimary":"ok@example.com"}', JSON.stringify({ remove: [PLACEHOLDER] })]);
  });

  it("a real former address is kept on the account", async () => {
    held = account(entry("alice@example.com", true, "registration"), entry("ok@example.com", false, "email-link"));
    const { result } = hook();
    await pass();
    expect(result.current.stateOf(ALICE, true).kind).toBe("unproved");
    await act(async () => result.current.add(ALICE, "ok@example.com"));
    expect(net.calls.slice(1)).toEqual(['{"setPrimary":"ok@example.com"}']);
  });

  it("a verified address that cannot be made primary: said, and tried again on request", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"), entry("ok@example.com", false, "email-link"));
    const { result } = hook();
    await pass();
    net.answer = async (_e, method) => {
      if (method === "account.get") return held;
      throw apiError("invalid-operation", {}, "not now");
    };
    await act(async () => result.current.add(ALICE, "ok@example.com"));
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "error", at: "read", message: "not now" });
    net.answer = async () => held;
    await act(async () => void (await result.current.recheck(ALICE)));
    expect(result.current.stateOf(ALICE, true).kind).toBe("proved");
  });

  it("an address already pending on the account is mailed again, not added twice", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"), pending("alice@example.com"));
    const { result } = hook();
    await pass();
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "missing", suggested: "alice@example.com" });
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    expect(net.calls.slice(1)).toEqual(['{"resend":["alice@example.com"]}']);
    expect(result.current.stateOf(ALICE, true).kind).toBe("waiting");
  });

  it("the poll runs only while the page is visible, reads once on focus, and stops on unmount", async () => {
    const { result, unmount } = hook();
    await pass();
    await act(async () => result.current.send(ALICE));
    expect(net.calls).toEqual(["account.get", '{"resend":["alice@example.com"]}']);
    await pass(PROOF_POLL_MS);
    expect(reads()).toBe(2);
    act(() => setVisibility("hidden"));
    await pass(PROOF_POLL_MS * 10);
    expect(reads()).toBe(2);
    act(() => setVisibility("visible"));
    await pass();
    expect(reads()).toBe(3);
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(reads()).toBe(4);
    await pass(PROOF_POLL_MS);
    expect(reads()).toBe(5);
    unmount();
    await pass(PROOF_POLL_MS * 10);
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(reads()).toBe(5);
  });

  it("a read that fails while waiting is tried again; a first read that fails says why, masked, and can be retried", async () => {
    net.answer = async () => {
      throw new Error("could not reach https://tok@alice.core.test/");
    };
    const { result } = hook();
    await pass();
    const state = result.current.stateOf(ALICE, true);
    expect(state).toMatchObject({ kind: "error", at: "read" });
    expect(JSON.stringify(state)).not.toContain("tok@");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("tok@");
    net.answer = async () => held;
    await act(async () => void (await result.current.recheck(ALICE)));
    expect(result.current.stateOf(ALICE, true).kind).toBe("unproved");
    await act(async () => result.current.send(ALICE));
    net.answer = async () => {
      throw new Error("network down");
    };
    await pass(PROOF_POLL_MS);
    expect(result.current.stateOf(ALICE, true).kind).toBe("waiting");
    net.answer = async () => account(entry("alice@example.com", true, "email-link"));
    await pass(PROOF_POLL_MS);
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "proved", here: true });
  });

  it("[RVQ4] a resend refused for now: cooldown until the time given, still polled, then offered again", async () => {
    const { result } = hook();
    await pass();
    net.answer = async (_e, method) => {
      if (method === "account.get") return held;
      throw apiError("invalid-operation", { retryAfterSeconds: 90 });
    };
    await act(async () => result.current.send(ALICE));
    const state = result.current.stateOf(ALICE, true);
    expect(state).toMatchObject({ kind: "cooldown", email: "alice@example.com", viaAdd: false, sent: true });
    expect((state as { until: number }).until).toBeCloseTo(Date.now() / 1000 + 90, 0);
    // Nothing is sent meanwhile, the link already mailed is still watched for.
    await act(async () => result.current.send(ALICE));
    expect(net.calls.filter((c) => c.includes("resend"))).toHaveLength(1);
    await pass(80_000);
    expect(reads()).toBe(1 + 20);
    expect(result.current.stateOf(ALICE, true).kind).toBe("cooldown");
    await pass(10_500);
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "waiting", canSendAgain: true });
  });

  it("a limit counted on the account, with no mail sent: back to the first step afterwards", async () => {
    const { result } = hook();
    await pass();
    net.answer = async (_e, method) => {
      if (method === "account.get") return held;
      throw apiError("too-many-attempts", { retryAfterSeconds: 30 });
    };
    await act(async () => result.current.send(ALICE));
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "cooldown", sent: false });
    await pass(31_000);
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "unproved", email: "alice@example.com" });
  });

  it("Send again is offered a while after a mail, and leaving an added address shows the form again", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook();
    await pass();
    await act(async () => result.current.add(ALICE, "typo@example.com"));
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "waiting", canSendAgain: false });
    await pass(SEND_AGAIN_AFTER_MS);
    expect(result.current.stateOf(ALICE, true)).toMatchObject({ kind: "waiting", canSendAgain: true });
    act(() => result.current.change(ALICE));
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "missing", suggested: null, changing: true });
    // The address left is not made primary when its link is opened after all.
    held = account(entry(PLACEHOLDER, true, "registration"), entry("typo@example.com", false, "email-link"));
    await pass(PROOF_POLL_MS * 3);
    expect(net.calls.filter((c) => c.includes("setPrimary"))).toEqual([]);
  });

  it("[RVQ5] an address another account holds: taken, on an add and on a resend", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook();
    await pass();
    net.answer = async () => {
      throw apiError("item-already-exists");
    };
    await act(async () => result.current.add(ALICE, "bob@example.com"));
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "taken", viaAdd: true });
    cleanup();
    held = account(entry("alice@example.com", true, "registration"));
    net.answer = async (_e, method) => {
      if (method === "account.get") return held;
      throw apiError("item-already-exists");
    };
    const other = hook();
    await pass();
    await act(async () => other.result.current.send(ALICE));
    expect(other.result.current.stateOf(ALICE, true)).toEqual({ kind: "taken", viaAdd: false });
  });

  it("[RVQ6] a platform without verification mail: unavailable unless proved", async () => {
    const unproved = hook(undefined, NO_MAIL);
    await pass();
    expect(unproved.result.current.stateOf(ALICE, true)).toEqual({ kind: "unavailable" });
    unproved.unmount();
    held = account(entry(PLACEHOLDER, true, "registration"));
    const missing = hook(undefined, NO_MAIL);
    await pass();
    expect(missing.result.current.stateOf(ALICE, true)).toEqual({ kind: "unavailable" });
    missing.unmount();
    held = account(entry("alice@example.com", true, "operator"));
    const proved = hook(undefined, NO_MAIL);
    await pass();
    expect(proved.result.current.stateOf(ALICE, true).kind).toBe("proved");
  });

  it("[RVQ7] a consent that only reads the address, where registration asks for a proof: the address is added, not set", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook([{ endpoint: ALICE, required: false }], GATED);
    await pass();
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    expect(net.calls.slice(1)).toEqual(['{"add":["alice@example.com"]}']);
    expect(result.current.stateOf(ALICE, false).kind).toBe("waiting");
  });

  it("[RVQB] a consent that only reads the address, elsewhere: the address is set as before, no proof waited for", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const updates: unknown[] = [];
    const { result } = hook([{ endpoint: ALICE, required: false }], CAN_MAIL);
    await pass();
    net.answer = async (_e, _m, params) => {
      updates.push(params);
      return { email: "alice@example.com" };
    };
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    expect(updates).toEqual([{ update: { email: "alice@example.com" } }]);
    expect(result.current.stateOf(ALICE, false)).toEqual({ kind: "added", email: "alice@example.com" });
    // A consent requiring a proof, shown afterwards on the same account, still waits for one.
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "unproved", email: "alice@example.com" });
  });

  it("an account that left the page: its late answer is dropped, nothing more is written for it", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"), pending("alice@example.com"));
    const { result, rerender } = hook();
    await pass();
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    let release: (v: unknown) => void = () => {};
    net.answer = (endpoint) =>
      endpoint === ALICE
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(account(entry("bob@example.com", true, "registration")));
    await pass(PROOF_POLL_MS);
    rerender({ requests: [{ endpoint: BOB, required: true }], info: CAN_MAIL });
    await pass();
    release(account(entry(PLACEHOLDER, true, "registration"), entry("alice@example.com", false, "email-link")));
    await pass();
    expect(net.calls.some((c) => c.includes("setPrimary"))).toBe(false);
    expect(result.current.stateOf(BOB, true)).toEqual({ kind: "unproved", email: "bob@example.com" });
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "checking" });
    // Back: read again.
    net.answer = async () => account(entry("alice@example.com", true, "email-link"));
    rerender({ requests: [{ endpoint: ALICE, required: true }], info: CAN_MAIL });
    await pass();
    expect(result.current.proved(ALICE)).toBe(true);
  });

  it("[RVF1] not verified, no link asked for here: read again on focus and when visible, never on a timer", async () => {
    const { result, unmount } = hook();
    await pass();
    expect(result.current.stateOf(ALICE, true).kind).toBe("unproved");
    // No interval.
    await pass(PROOF_POLL_MS * 10);
    expect(reads()).toBe(1);
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(reads()).toBe(2);
    act(() => setVisibility("hidden"));
    await pass();
    expect(reads()).toBe(2);
    act(() => setVisibility("visible"));
    await pass();
    expect(reads()).toBe(3);
    // A re-read that fails keeps the state shown.
    net.answer = async () => {
      throw new Error("network down");
    };
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "unproved", email: "alice@example.com" });
    // Proved elsewhere (the welcome mail's link): seen on the next return, nothing written.
    net.answer = async () => account(entry("alice@example.com", true, "email-link"));
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "proved", email: "alice@example.com", here: false });
    expect(net.calls.every((c) => c === "account.get")).toBe(true);
    // Proved: no more re-reads.
    const before = reads();
    act(() => void window.dispatchEvent(new Event("focus")));
    await pass();
    expect(reads()).toBe(before);
    unmount();
  });

  it("[RVF2] Use another address, then Cancel: the account is read again and shown as it stands", async () => {
    const { result } = hook();
    await pass();
    act(() => result.current.change(ALICE));
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "missing", suggested: null, changing: true });
    // A refused address keeps the way back.
    net.answer = async (_e, method) => {
      if (method === "account.get") return held;
      throw apiError("item-already-exists");
    };
    await act(async () => result.current.add(ALICE, "bob@example.com"));
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "taken", viaAdd: true, changing: true });
    const readsBefore = reads();
    await act(async () => result.current.cancel(ALICE));
    expect(reads()).toBe(readsBefore + 1);
    expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "unproved", email: "alice@example.com" });
    // Cancel outside a change does nothing.
    await act(async () => result.current.cancel(ALICE));
    expect(reads()).toBe(readsBefore + 1);
  });

  it("[RVC1] a cooldown the core reports on the address: shown after a reload, then Send again offered", async () => {
    const now = Date.now() / 1000;
    held = account({ ...entry("alice@example.com", true, null, "pending"), verificationCooldownUntil: now + 90 });
    const { result } = hook();
    await pass();
    expect(result.current.stateOf(ALICE, true)).toEqual({
      kind: "cooldown", email: "alice@example.com", viaAdd: false, until: now + 90, sent: true,
    });
    // Nothing is sent meanwhile; the link already mailed is watched for.
    await act(async () => result.current.send(ALICE));
    expect(net.calls.filter((c) => c.includes("resend"))).toEqual([]);
    await pass(PROOF_POLL_MS);
    expect(reads()).toBe(2);
    await pass(90_000);
    expect(result.current.stateOf(ALICE, true)).toEqual({
      kind: "waiting", email: "alice@example.com", viaAdd: false, canSendAgain: true,
    });
  });

  it("[RVC2] no cooldown running (null), one already over, or a core that does not say: not verified, as before", async () => {
    const now = Date.now() / 1000;
    for (const until of [null, now - 1, undefined, "soon"]) {
      held = account({ ...entry("alice@example.com", true, null, "pending"), verificationCooldownUntil: until });
      const { result, unmount } = hook();
      await pass();
      expect(result.current.stateOf(ALICE, true)).toEqual({ kind: "unproved", email: "alice@example.com" });
      unmount();
    }
  });

  it("[RVC3] an added address in cooldown, back from Use another address: its cooldown is shown", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook();
    await pass();
    const until = Date.now() / 1000 + 60;
    net.answer = async (_e, method, params) => {
      const ops = params.update?.emails as { add?: string[] } | undefined;
      if (method === "account.update" && ops?.add) {
        held = account(entry(PLACEHOLDER, true, "registration"), { ...pending(ops.add[0]), verificationCooldownUntil: until });
      }
      return held;
    };
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    act(() => result.current.change(ALICE));
    await act(async () => result.current.cancel(ALICE));
    expect(result.current.stateOf(ALICE, true)).toEqual({
      kind: "cooldown", email: "alice@example.com", viaAdd: true, until, sent: true,
    });
  });

  it("Cancel after leaving an added address: that address is waited for again", async () => {
    held = account(entry(PLACEHOLDER, true, "registration"));
    const { result } = hook();
    await pass();
    net.answer = async (_e, method, params) => {
      const ops = params.update?.emails as { add?: string[] } | undefined;
      if (method === "account.update" && ops?.add) held = account(entry(PLACEHOLDER, true, "registration"), pending(ops.add[0]));
      return held;
    };
    await act(async () => result.current.add(ALICE, "alice@example.com"));
    act(() => result.current.change(ALICE));
    await act(async () => result.current.cancel(ALICE));
    expect(result.current.stateOf(ALICE, true)).toEqual({
      kind: "waiting", email: "alice@example.com", viaAdd: true, canSendAgain: true,
    });
    // Its link opened: made primary, as before the change.
    held = account(entry(PLACEHOLDER, true, "registration"), entry("alice@example.com", false, "email-link"));
    await pass(PROOF_POLL_MS);
    expect(net.calls).toContain('{"setPrimary":"alice@example.com"}');
  });
});
