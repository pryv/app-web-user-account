import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * [AAGT] The sign-in gate plumbing: the operator's `pendingAccountActs` names a
 * page to show after sign-in; where the sign-in was going is kept in this
 * tab's storage (never in the URL) and resumed when the page is done.
 */

const gate = vi.hoisted(() => ({ pendingAccountActs: vi.fn() }));
vi.mock("../extensions/signInGate", () => gate);

import {
  accountActsGate,
  continueSignedIn,
  resumeAfterAccountActs,
  takeAccountActsResume,
} from "./accountActsGate";
import type { PryvConnection } from "./session";

const conn = { endpoint: "https://alice.core.test/" } as unknown as PryvConnection;
const KEY = "pryv.accountActs.resume";

/** A minimal sessionStorage for the node environment. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => {
  gate.pendingAccountActs.mockReset();
  vi.unstubAllGlobals();
});

describe("[AAGT] sign-in gate", () => {
  it("[AAG1] nothing pending: goes straight to the target, remembers nothing", async () => {
    gate.pendingAccountActs.mockResolvedValue(null);
    const navigate = vi.fn();
    await continueSignedIn(conn, { kind: "internal", path: "/account/profile" }, navigate, { replace: false });
    expect(gate.pendingAccountActs).toHaveBeenCalledWith(conn);
    expect(navigate).toHaveBeenCalledWith("/account/profile", { replace: false });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("[AAG2] a pending act: goes to the gate page first, then resumes the original target with its state", async () => {
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    const navigate = vi.fn();
    await continueSignedIn(conn, { kind: "internal", path: "/cmc-accept?capabilityUrl=c" }, navigate, { replace: true, state: { from: "x" } });
    expect(navigate).toHaveBeenCalledWith("/legal-acts", { replace: true });

    const back = vi.fn();
    resumeAfterAccountActs(back);
    expect(back).toHaveBeenCalledWith("/cmc-accept?capabilityUrl=c", { replace: true, state: { from: "x" } });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("[AAG8] a sign-in continuing to /auth is not checked on the way: /auth checks it", async () => {
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    const navigate = vi.fn();
    await continueSignedIn(conn, { kind: "internal", path: "/auth?poll=p" }, navigate, { replace: true });
    expect(gate.pendingAccountActs).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/auth?poll=p", { replace: true });
  });

  it("[AAG9] a check with nothing pending clears a target left by an abandoned detour", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ target: { kind: "internal", path: "/account/apps" } }));
    gate.pendingAccountActs.mockResolvedValue(null);
    await accountActsGate(conn, { target: { kind: "internal", path: "/account/profile" } });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("[AAG3] an answer that is not a path on this app is ignored", async () => {
    for (const answer of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "legal", 42]) {
      gate.pendingAccountActs.mockResolvedValue(answer);
      expect(await accountActsGate(conn, { target: { kind: "internal", path: "/account/profile" } })).toBeNull();
    }
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("[AAG4] a failed check is logged and the user goes on", async () => {
    gate.pendingAccountActs.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const navigate = vi.fn();
    await continueSignedIn(conn, { kind: "internal", path: "/account/profile" }, navigate);
    expect(navigate).toHaveBeenCalledWith("/account/profile", {});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("[AAG5] nothing remembered: the gate page resumes to the profile", () => {
    const back = vi.fn();
    resumeAfterAccountActs(back);
    expect(back).toHaveBeenCalledWith("/account/profile", { replace: true, state: undefined });
  });

  it("[AAG6] a stored target that is not valid is dropped", () => {
    for (const bad of [
      { target: { kind: "external", href: "javascript:alert(1)" } },
      { target: { kind: "internal", path: "//evil.example" } },
      { target: { kind: "other" } },
      "not json",
    ]) {
      sessionStorage.setItem(KEY, typeof bad === "string" ? bad : JSON.stringify(bad));
      expect(takeAccountActsResume()).toBeNull();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    }
  });

  it("[AAG7] an external target (returnURL hand-off) is kept for the resume", async () => {
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    await continueSignedIn(conn, { kind: "external", href: "https://app.test/cb?state=s" }, vi.fn());
    expect(takeAccountActsResume()).toEqual({ target: { kind: "external", href: "https://app.test/cb?state=s" } });
  });
});
