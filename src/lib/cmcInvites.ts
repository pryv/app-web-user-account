/**
 * Consent invites carried by an access request (`cmcInvites` on the poll
 * state). The app asks the user, in the same authorisation request, to also
 * answer one or more cross-account messaging invites (capability URLs it
 * received from a requester). `/auth` shows each invite as its own block,
 * accepts the approved ones before granting the app access, and posts one
 * outcome per invite with ACCEPTED.
 *
 * The outcomes are a hint: the requester learns the truth from its own inbox
 * (`@pryv/cmc` `waitForAccept`). `mandatory` is enforced here, by the page: a
 * declined mandatory invite ends the request REFUSED with
 * `REFUSED_MANDATORY_CONSENT` before anything is written.
 *
 * Pure helpers, plus the reads the page cannot get from `cmc.readOffer`
 * (where the accept belongs and the offer's id, `readOfferRef`; whether this
 * account already gave the consent, `readGivenConsent`).
 */

import { Pryv } from "./pryvClient";

/** One invite of the request, as the core normalised it. */
export interface CmcInvite {
  capabilityUrl: string;
  mandatory: boolean;
  for: "self" | "target";
}

/** The outcome posted for one invite with ACCEPTED, in the request's order. */
export type CmcInviteOutcome =
  | { acceptEventId: string; dataGrantAccessId?: string; acceptedFor?: "self" }
  | { declined: true }
  | { reason: string };

/**
 * What the user chose for one invite block, or `given` when this account
 * already accepted the offer (nothing to decide, nothing written).
 */
export type InviteDecision = "approve" | "decline" | "given";

/** `reasonId` of the REFUSED answer when the user declined a mandatory invite (reserved by the core). */
export const REFUSED_MANDATORY_CONSENT = "REFUSED_MANDATORY_CONSENT";
/** `reasonId` of the REFUSED answer when a mandatory invite could not be accepted. */
export const MANDATORY_CONSENT_FAILED = "MANDATORY_CONSENT_FAILED";

/** Longest id or reason the core accepts in an outcome. */
const MAX_FIELD_LENGTH = 256;

/**
 * The invites of a poll state, or null when it carries none. Read
 * defensively (the core normalises them, but the page never trusts a shape it
 * did not check). Every entry is kept, so the outcomes match the request one
 * for one: an entry without an http(s) capability URL gets an empty one, which
 * the page shows as unreadable (it can only be declined).
 */
export function invitesOf(state: { cmcInvites?: unknown } | null | undefined): CmcInvite[] | null {
  const raw = state?.cmcInvites;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((entry: unknown) => {
    const e = (entry != null && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const url = typeof e.capabilityUrl === "string" && /^https?:\/\//i.test(e.capabilityUrl) ? e.capabilityUrl : "";
    return { capabilityUrl: url, mandatory: e.mandatory === true, for: e.for === "target" ? "target" : "self" };
  });
}

/** Whether every invite block has a decision. */
export function allDecided(decisions: ReadonlyArray<InviteDecision | null>, count: number): boolean {
  return decisions.length === count && decisions.every((d) => d != null);
}

/** Index of the first mandatory invite the user declined, or -1. */
export function declinedMandatory(invites: readonly CmcInvite[], decisions: ReadonlyArray<InviteDecision | null>): number {
  return invites.findIndex((inv, i) => inv.mandatory && decisions[i] === "decline");
}

/**
 * Indexes of the invites to accept, mandatory ones first (each group in the
 * request's order), so a mandatory failure stops the flow before any optional
 * invite is accepted.
 */
export function acceptOrder(invites: readonly CmcInvite[], decisions: ReadonlyArray<InviteDecision | null>): number[] {
  const approved = invites.map((_, i) => i).filter((i) => decisions[i] === "approve");
  return [...approved.filter((i) => invites[i].mandatory), ...approved.filter((i) => !invites[i].mandatory)];
}

/** A reason the core accepts in an outcome: non-empty, at most 256 characters. */
export function boundedReason(reason: string | null | undefined): string {
  const r = (reason ?? "").trim() || "cmc-accept-failed";
  return r.length > MAX_FIELD_LENGTH ? r.slice(0, MAX_FIELD_LENGTH) : r;
}

/**
 * The outcome of an accepted invite, from what `cmc.acceptInvite` returned.
 * `dataGrantAccessId` is included when the platform already reported it.
 */
export function acceptedOutcome(
  res: { acceptEventId: string; dataGrantAccessId?: string | null },
  acceptedForSelf: boolean,
): CmcInviteOutcome {
  const out: { acceptEventId: string; dataGrantAccessId?: string; acceptedFor?: "self" } = {
    acceptEventId: res.acceptEventId.slice(0, MAX_FIELD_LENGTH),
  };
  if (typeof res.dataGrantAccessId === "string" && res.dataGrantAccessId !== "") {
    out.dataGrantAccessId = res.dataGrantAccessId.slice(0, MAX_FIELD_LENGTH);
  }
  if (acceptedForSelf) out.acceptedFor = "self";
  return out;
}

const APP_SCOPE_PREFIX = ":_cmc:apps:";
// The plugin's rule: any non-colon text per segment (no whitespace here), never
// its own `chats` / `collectors` segments.
const SCOPE_SEGMENT = /^[^:\s]{1,100}$/;
const MAX_SCOPE_LENGTH = 512;

function isAppScope(streamId: unknown): streamId is string {
  if (typeof streamId !== "string" || !streamId.startsWith(APP_SCOPE_PREFIX)) return false;
  if (streamId.length > MAX_SCOPE_LENGTH) return false;
  const segments = streamId.slice(APP_SCOPE_PREFIX.length).split(":");
  return segments.every((s) => SCOPE_SEGMENT.test(s) && s !== "chats" && s !== "collectors");
}

/**
 * Where the accept of an offer belongs on the accepting account: the
 * requester's scope stamped on the offer (`originStreamId`, the relationship's
 * identifier on both accounts), else the requester's app scope
 * (`:_cmc:apps:<appId>`), else null (the invite cannot be accepted here).
 */
export function scopeFromOffer(content: unknown): string | null {
  if (content == null || typeof content !== "object") return null;
  const c = content as { originStreamId?: unknown; requesterMeta?: { appId?: unknown } };
  if (isAppScope(c.originStreamId)) return c.originStreamId;
  const appId = c.requesterMeta?.appId;
  if (typeof appId === "string" && isAppScope(APP_SCOPE_PREFIX + appId)) return APP_SCOPE_PREFIX + appId;
  return null;
}

/** What the page needs from an offer besides `cmc.readOffer`: where its accept belongs, and the offer event's id. */
export interface OfferRef {
  /** See `scopeFromOffer`; null when the offer names none. */
  scope: string | null;
  /** The offer event's id, as stamped on every grant minted from it (`clientData.cmc.offerEventId`). */
  offerEventId: string | null;
}

/**
 * Read the offer behind a capability URL once more through the capability
 * access, the way `cmc.readOffer` does, for what it does not return: the
 * offer's scope and its event id. Both null when it cannot be read.
 */
export async function readOfferRef(capabilityUrl: string): Promise<OfferRef> {
  try {
    const cap = new Pryv.Connection(capabilityUrl);
    const events = (await cap.apiOne("events.get", { types: ["consent/request-cmc"], limit: 1 }, "events")) as Array<{
      id?: unknown;
      content?: unknown;
    }>;
    if (!Array.isArray(events) || events.length !== 1) return { scope: null, offerEventId: null };
    const id = events[0]?.id;
    return {
      scope: scopeFromOffer(events[0]?.content),
      offerEventId: typeof id === "string" && id !== "" ? id : null,
    };
  } catch {
    return { scope: null, offerEventId: null };
  }
}

/**
 * Read the offer behind a capability URL and return its scope (see
 * `scopeFromOffer`), or null when it cannot be read or carries no usable scope.
 */
export async function readOfferScope(capabilityUrl: string): Promise<string | null> {
  return (await readOfferRef(capabilityUrl)).scope;
}

/** A consent this account already gave to an offer: the live grant minted from it. */
export interface GivenConsent {
  /** The grant (`dataGrantAccessId` in the outcome). */
  accessId: string;
  /** The accept event that minted it, as stamped on the grant. */
  acceptEventId: string;
  /** When the grant was created (seconds), shown as "already given on". */
  created: number | null;
}

/** The fields of an access `givenConsentOf` reads. */
interface GrantLike {
  id?: unknown;
  created?: unknown;
  expires?: unknown;
  deleted?: unknown;
  clientData?: { cmc?: unknown } | null;
}

/**
 * The live grant this account holds for the offer `offerEventId`, or null.
 * A grant is the access the core mints on accept, stamped
 * `clientData.cmc.role: 'counterparty'` with the offer's event id and the
 * accept event's id. The access is what proves a live consent (the accept
 * event outlives a withdrawn grant), so a deleted or expired one does not
 * count, nor one without the accept event id an outcome must carry. With
 * several (an open-link offer accepted twice), the earliest.
 */
export function givenConsentOf(
  accesses: readonly GrantLike[] | null | undefined,
  offerEventId: string,
  nowSeconds: number = Date.now() / 1000,
): GivenConsent | null {
  if (!Array.isArray(accesses) || offerEventId === "") return null;
  let found: GivenConsent | null = null;
  for (const a of accesses) {
    if (a == null || typeof a !== "object") continue;
    const cmc = (a.clientData?.cmc ?? null) as { role?: unknown; offerEventId?: unknown; acceptEventId?: unknown } | null;
    if (cmc == null || cmc.role !== "counterparty" || cmc.offerEventId !== offerEventId) continue;
    if (!isBoundedId(a.id) || !isBoundedId(cmc.acceptEventId)) continue;
    if (a.deleted != null) continue;
    if (typeof a.expires === "number" && a.expires <= nowSeconds) continue;
    const created = typeof a.created === "number" && Number.isFinite(a.created) ? a.created : null;
    if (found == null || (created != null && (found.created == null || created < found.created))) {
      found = { accessId: a.id, acceptEventId: cmc.acceptEventId, created };
    }
  }
  return found;
}

function isBoundedId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= MAX_FIELD_LENGTH;
}

/**
 * The live grant the account behind `apiEndpoint` (token-bearing) holds for
 * the offer `offerEventId`, or null. Throws when the accesses cannot be
 * listed: the page then shows the invite as it would without this check.
 */
export async function readGivenConsent(apiEndpoint: string, offerEventId: string): Promise<GivenConsent | null> {
  const conn = new Pryv.Connection(apiEndpoint);
  const accesses = (await conn.apiOne("accesses.get", {}, "accesses")) as GrantLike[];
  return givenConsentOf(accesses, offerEventId);
}

/**
 * The outcome of an invite whose offer this account already accepted: the
 * grant in place, reported as an accept would be (nothing is written).
 */
export function givenOutcome(given: GivenConsent, acceptedForSelf: boolean): CmcInviteOutcome {
  return acceptedOutcome({ acceptEventId: given.acceptEventId, dataGrantAccessId: given.accessId }, acceptedForSelf);
}
