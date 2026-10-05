import { describe, it, expect, vi } from "vitest";
import Pryv from "pryv";
import { withLanguage } from "../test/withLanguage";
import { DelegationError, errorIds } from "@pryv/delegation";
import type { DelegateRecord, ControlledRecord } from "@pryv/delegation";
import {
  delegationErrorMessage,
  delegationErrorId,
  isGenuineLoginRequired,
  isGrantRequiresOwner,
  GRANT_REQUIRES_OWNER_ID,
  GRANT_REQUIRES_OWNER_MESSAGE,
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
  consentGrantsOf,
  toConsentGrantReview,
  approvedByUsername,
  acceptDelivered,
  detachDelegate,
  INVALID_KEEP_LIST_ID,
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

  // A refused API call raised by `pryv` before 3.14.2 embeds the request params
  // in its own message: on account creation that is the password. Never show it.
  it("[DEM1] a refused API call shows the platform's message, never the request params", () => {
    const refused = new Pryv.PryvError(
      'Error for api method: "delegations.createAccount" with params: {"username":"kid","password":"s3cret-pw"} >> Result: {}',
      { id: "invalid-parameters-format", message: "The password is too weak." },
    );
    expect(delegationErrorMessage(refused)).toBe("The password is too weak.");
    const noMessage = new Pryv.PryvError('Error for api method: "x" with params: {"password":"s3cret-pw"}', { id: "forbidden" });
    const shown = delegationErrorMessage(noMessage);
    expect(shown).not.toContain("s3cret-pw");
    expect(shown).toMatch(/something went wrong/i);
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
  it("reads the API error id a pryv PryvError carries in innerObject", () => {
    expect(delegationErrorId(pryvError(errorIds.GRANT_REQUIRES_OWNER))).toBe(errorIds.GRANT_REQUIRES_OWNER);
  });
});

/**
 * Shape `pryv`'s `Connection.apiOne` throws for a platform refusal: the API error
 * sits in `innerObject`, the delegation id under its `data.id`.
 */
function pryvError(id: string): Error {
  return new Pryv.PryvError("Error for api method: \"events.create\" >> Result: {...}", {
    id: "invalid-operation",
    message: "Writing \"x\" with a token obtained through account delegation is not allowed",
    data: { id, eventType: "x" },
  });
}

describe("[GROW] grant refused to a delegate token", () => {
  it("explains that only the owner can answer, whatever the error shape", () => {
    for (const e of [err(errorIds.GRANT_REQUIRES_OWNER), pryvError(errorIds.GRANT_REQUIRES_OWNER)]) {
      expect(isGrantRequiresOwner(e)).toBe(true);
      expect(delegationErrorMessage(e)).toBe(GRANT_REQUIRES_OWNER_MESSAGE);
    }
    expect(GRANT_REQUIRES_OWNER_ID).toBe("delegation-grant-requires-owner");
  });
  it("does not match other refusals", () => {
    expect(isGrantRequiresOwner(pryvError("forbidden"))).toBe(false);
    expect(isGrantRequiresOwner(new Error("x"))).toBe(false);
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
  it("[DFS1] follows the page's language, not the browser's", () => {
    const date = new Date(1609459200 * 1000);
    const style = { day: "numeric", month: "short", year: "numeric" } as const;
    for (const lang of ["de", "en-US", "ja"]) {
      withLanguage(lang, () => expect(formatSince(1609459200), lang).toBe(date.toLocaleDateString(lang, style)));
    }
    // The three differ, so the language is what decides.
    expect(new Set(["de", "en-US", "ja"].map((l) => date.toLocaleDateString(l, style))).size).toBe(3);
    // A tag the runtime cannot format in: the browser's format, no throw.
    withLanguage("not a tag!", () => expect(formatSince(1609459200)).toBe(date.toLocaleDateString(undefined, style)));
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

describe("[DKP1] consents a delegate gave, for the detach review", () => {
  const lineage = (relId: string, kind = "delegated-child") => ({ kind, relId, delegate: { username: "parent" }, viaAccessId: "pat" });
  const grant = (id: string, relId: string, extra: Record<string, unknown> = {}) => ({
    id,
    created: 1_700_000_000,
    permissions: [{ streamId: "diary", level: "read" }],
    clientData: {
      cmc: { role: "counterparty", acceptEventId: "ev-" + id, counterparty: { username: "doctor", host: "peer.example.com" } },
      delegation: lineage(relId),
      ...extra,
    },
  });

  it("keeps only consent grants carrying this relationship's lineage", () => {
    const accesses = [
      grant("mine", "rel-1"),
      grant("other-relationship", "rel-2"),
      { id: "owner-consent", clientData: { cmc: { role: "counterparty" } } },
      { id: "app-for-kid", clientData: { delegation: lineage("rel-1") } },
      { id: "delegate-session", clientData: { delegation: lineage("rel-1", "delegate-pat") } },
      { ...grant("requester-side", "rel-1"), clientData: { cmc: { role: "requester" }, delegation: lineage("rel-1") } },
      { id: "plain" },
    ];
    expect(consentGrantsOf(accesses, "rel-1").map((a) => a.id)).toEqual(["mine"]);
  });

  it("describes a grant: who asked, what, when; who approved comes from the accept event", () => {
    const review = toConsentGrantReview(grant("g1", "rel-1"));
    expect(review.accessId).toBe("g1");
    expect(review.requester).toBe("doctor (peer.example.com)");
    expect(review.permissions).toEqual([{ streamId: "diary", level: "read" }]);
    expect(review.givenOnText).not.toBe("");
    expect(review.acceptEventId).toBe("ev-g1");
    expect(review.approvedBy).toBeNull();
    expect(approvedByUsername({ content: { approvedBy: { delegate: { username: "parent" }, relId: "rel-1" } } })).toBe("parent");
    expect(approvedByUsername({ content: {} })).toBeNull();
    expect(approvedByUsername(undefined)).toBeNull();
    expect(review.delivered).toBeNull();
    expect(acceptDelivered({ content: { status: "completed" } })).toBe(true);
    expect(acceptDelivered({ content: { status: "failed" } })).toBe(false);
    expect(acceptDelivered({ content: { status: "pending" } })).toBe(false);
    expect(acceptDelivered(undefined)).toBeNull();
  });

  it("detaches with the plain client call when nothing is kept, and passes the keep list otherwise", async () => {
    const client = { detachDelegate: vi.fn(async () => {}), connection: { apiOne: vi.fn(async () => ({})) } };
    await detachDelegate(client as never, "parent");
    await detachDelegate(client as never, "parent", []);
    expect(client.detachDelegate).toHaveBeenCalledTimes(2);
    expect(client.detachDelegate).toHaveBeenNthCalledWith(1, "parent");
    expect(client.detachDelegate).toHaveBeenNthCalledWith(2, "parent");
    await detachDelegate(client as never, "parent", ["g1", "g2"]);
    expect(client.detachDelegate).toHaveBeenNthCalledWith(3, "parent", { keepAccessIds: ["g1", "g2"] });
    expect(client.connection.apiOne).not.toHaveBeenCalled();
  });

  it("explains a refused keep list", () => {
    const refused = Object.assign(new Error("refused"), { innerObject: { id: INVALID_KEEP_LIST_ID, message: "refused" } });
    expect(delegationErrorId(refused)).toBe(INVALID_KEEP_LIST_ID);
    expect(delegationErrorMessage(refused)).toMatch(/no longer belong to this delegate/i);
    // As @pryv/delegation 3.15.0 wraps it: a DelegationError carrying the id.
    expect(delegationErrorMessage(err(INVALID_KEEP_LIST_ID))).toMatch(/no longer belong to this delegate/i);
  });
});
