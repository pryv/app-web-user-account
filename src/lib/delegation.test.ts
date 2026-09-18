import { describe, it, expect, vi } from "vitest";
import { DelegationError, errorIds } from "@pryv/delegation";
import type { DelegateRecord, ControlledRecord } from "@pryv/delegation";
import {
  delegationErrorMessage,
  delegationErrorId,
  isGenuineLoginRequired,
  runFlow,
  statusLabel,
  formatSince,
  toDelegateRow,
  toControlledRow,
  coresFromServiceInfo,
  DELEGATE_WARNING_LINES,
  DELEGATE_WARNING_LEAD,
  delegationManagedKind,
  managedKindLabel,
} from "./delegation";

const err = (id: string, message = "server said no") => new DelegationError(message, id);

describe("delegationErrorMessage", () => {
  it("maps the genuine-login gate to an owner-must-sign-in message", () => {
    const msg = delegationErrorMessage(err(errorIds.GENUINE_LOGIN_REQUIRED));
    expect(msg).toMatch(/sign in to this account directly/i);
  });

  it("maps username-taken", () => {
    expect(delegationErrorMessage(err(errorIds.USERNAME_TAKEN))).toMatch(/already taken/i);
  });

  it("maps already-exists", () => {
    expect(delegationErrorMessage(err(errorIds.ALREADY_EXISTS))).toMatch(/pending or active/i);
  });

  it("maps unknown-core", () => {
    expect(delegationErrorMessage(err(errorIds.UNKNOWN_CORE))).toMatch(/not part of this platform/i);
  });

  it("maps invite-expired and not-active", () => {
    expect(delegationErrorMessage(err(errorIds.INVITE_EXPIRED))).toMatch(/expired/i);
    expect(delegationErrorMessage(err(errorIds.NOT_ACTIVE))).toMatch(/no longer active/i);
  });

  it("maps mirror-not-stale", () => {
    expect(delegationErrorMessage(err(errorIds.MIRROR_NOT_STALE))).toMatch(/still active/i);
  });

  it("falls back to a plain Error message", () => {
    expect(delegationErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to a generic message for unknown shapes", () => {
    expect(delegationErrorMessage(null)).toMatch(/something went wrong/i);
  });
});

describe("delegationErrorId / isGenuineLoginRequired", () => {
  it("reads the id off a DelegationError", () => {
    expect(delegationErrorId(err(errorIds.NOT_FOUND))).toBe(errorIds.NOT_FOUND);
  });
  it("reads the id off a plain id-carrying object", () => {
    expect(delegationErrorId({ id: "delegation-not-active" })).toBe("delegation-not-active");
  });
  it("returns undefined when no id is present", () => {
    expect(delegationErrorId(new Error("x"))).toBeUndefined();
  });
  it("detects the genuine-login gate", () => {
    expect(isGenuineLoginRequired(err(errorIds.GENUINE_LOGIN_REQUIRED))).toBe(true);
    expect(isGenuineLoginRequired(err(errorIds.NOT_FOUND))).toBe(false);
  });
});

describe("runFlow", () => {
  it("wraps a resolved value", async () => {
    const res = await runFlow(async () => 42);
    expect(res).toEqual({ ok: true, value: 42 });
  });

  it("translates a DelegationError rejection into a message + id", async () => {
    const res = await runFlow(async () => {
      throw err(errorIds.ALREADY_EXISTS);
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.id).toBe(errorIds.ALREADY_EXISTS);
      expect(res.message).toMatch(/pending or active/i);
    }
  });
});

describe("statusLabel", () => {
  it("labels each status", () => {
    expect(statusLabel("invite")).toBe("Invitation pending");
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("stale")).toBe("Unavailable");
  });
});

describe("formatSince", () => {
  it("returns empty for missing timestamps", () => {
    expect(formatSince(undefined)).toBe("");
    expect(formatSince(null)).toBe("");
  });
  it("formats an epoch-seconds timestamp", () => {
    // 2021-01-01T00:00:00Z in seconds.
    expect(formatSince(1609459200)).not.toBe("");
  });
});

describe("row view-models", () => {
  it("builds a My-delegates row with status + detach for an active delegate", () => {
    const rec: DelegateRecord = {
      relId: "r1",
      delegate: { username: "parent", hostSlug: "core1-pryv-io" },
      status: "active",
      requestedAt: 1609459200,
      activatedAt: 1609545600,
    };
    const row = toDelegateRow(rec);
    expect(row.username).toBe("parent");
    expect(row.statusText).toBe("Active");
    expect(row.action).toBe("detach");
    expect(row.sinceText).not.toBe("");
  });

  it("builds a My-delegates row with cancel for a pending invite", () => {
    const rec: DelegateRecord = {
      relId: "r2",
      delegate: { username: "mum", hostSlug: "core1-pryv-io" },
      status: "invite",
      requestedAt: 1609459200,
    };
    expect(toDelegateRow(rec).action).toBe("cancel");
    expect(toDelegateRow(rec).statusText).toBe("Invitation pending");
  });

  it("classifies controlled rows by status", () => {
    const base = { relId: "c", controlled: { username: "kid", hostSlug: "core2-pryv-io" }, requestedAt: 1 };
    expect(toControlledRow({ ...base, status: "invite" } as ControlledRecord).kind).toBe("invite");
    expect(toControlledRow({ ...base, status: "active" } as ControlledRecord).kind).toBe("active");
    expect(toControlledRow({ ...base, status: "stale" } as ControlledRecord).kind).toBe("stale");
  });
});

describe("coresFromServiceInfo", () => {
  it("returns [] for a single-core platform (no cores field)", () => {
    expect(coresFromServiceInfo({ serial: "1" })).toEqual([]);
    expect(coresFromServiceInfo(null)).toEqual([]);
  });
  it("reads string and object core entries", () => {
    const out = coresFromServiceInfo({
      cores: ["core-a", { id: "core-b", name: "Core B" }, { url: "https://core-c" }],
    });
    expect(out.map((c) => c.id)).toEqual(["core-a", "core-b", "https://core-c"]);
    expect(out[1].label).toBe("Core B");
  });
});

describe("warning copy (corrected security narrative)", () => {
  const all = [DELEGATE_WARNING_LEAD, ...DELEGATE_WARNING_LINES].join(" ").toLowerCase();
  it("states full control and audit", () => {
    expect(all).toContain("full control");
    expect(all).toContain("audit trail");
  });
  it("warns that a delegate can log in directly and remove other delegates", () => {
    expect(all).toContain("log in to the account directly");
    expect(all).toContain("remove other delegates");
    expect(all).toContain("password");
  });
  it("does NOT claim co-delegate eviction is impossible", () => {
    expect(all).not.toContain("impossible");
  });
});

/* ---- Flow integration against a mocked @pryv/delegation client ---- */

describe("delegation flows (mocked client)", () => {
  it("request-a-delegate: success then already-exists", async () => {
    const requestAttach = vi
      .fn()
      .mockResolvedValueOnce({ relId: "r", status: "invite" })
      .mockRejectedValueOnce(err(errorIds.ALREADY_EXISTS));

    const ok = await runFlow(() => requestAttach("parent"));
    expect(ok.ok).toBe(true);

    const dup = await runFlow(() => requestAttach("parent"));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.id).toBe(errorIds.ALREADY_EXISTS);
    expect(requestAttach).toHaveBeenCalledTimes(2);
  });

  it("create-account: success then username-taken", async () => {
    const createAccount = vi
      .fn()
      .mockResolvedValueOnce({ delegation: { relId: "r", status: "active" } })
      .mockRejectedValueOnce(err(errorIds.USERNAME_TAKEN));

    const ok = await runFlow(() => createAccount({ username: "kiddo" }));
    expect(ok.ok).toBe(true);

    const taken = await runFlow(() => createAccount({ username: "kiddo" }));
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.message).toMatch(/already taken/i);
  });

  it("accept: surfaces the activation record", async () => {
    const acceptAttach = vi.fn().mockResolvedValue({ relId: "r", status: "active", controlled: { username: "kid" } });
    const res = await runFlow(() => acceptAttach("kid"));
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as { status: string }).status).toBe("active");
  });

  it("detach on a delegated session surfaces genuine-login-required", async () => {
    const detachDelegate = vi.fn().mockRejectedValue(err(errorIds.GENUINE_LOGIN_REQUIRED));
    const res = await runFlow(() => detachDelegate("parent"));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(isGenuineLoginRequired({ id: res.id })).toBe(true);
      expect(res.message).toMatch(/sign in to this account directly/i);
    }
  });

  it("dismiss stale: success and non-stale rejection", async () => {
    const dismissControlled = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(err(errorIds.MIRROR_NOT_STALE));
    expect((await runFlow(() => dismissControlled("kid"))).ok).toBe(true);
    const busy = await runFlow(() => dismissControlled("kid"));
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.message).toMatch(/still active/i);
  });
});

describe("[DMK] delegation-managed accesses", () => {
  it("[DMK1] recognises the four kinds the server manages, and nothing else", () => {
    const withKind = (kind: unknown) => ({ clientData: { delegation: { kind, relId: "r1" } } });
    for (const kind of ["control", "delegate-pat", "invite-capability", "notify"]) {
      expect(delegationManagedKind(withKind(kind))).toBe(kind);
      expect(managedKindLabel(kind)).not.toBe(kind);
    }
    // an app granted through a delegation is an ordinary app
    expect(delegationManagedKind(withKind("delegated-child"))).toBeNull();
    for (const access of [withKind("toString"), withKind(1), { clientData: { delegation: null } }, { clientData: null }, {}, null]) {
      expect(delegationManagedKind(access)).toBeNull();
    }
  });
});
