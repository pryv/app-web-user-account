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
 * Pure helpers, plus the one read the page cannot get from `cmc.readOffer`
 * (where the accept belongs, `readOfferScope`).
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

/** What the user chose for one invite block. */
export type InviteDecision = "approve" | "decline";

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

/**
 * Read the offer behind a capability URL and return its scope (see
 * `scopeFromOffer`). `cmc.readOffer` does not return it, so the offer event is
 * read once more through the capability access, the way `readOffer` does.
 * Null when it cannot be read or carries no usable scope.
 */
export async function readOfferScope(capabilityUrl: string): Promise<string | null> {
  try {
    const cap = new Pryv.Connection(capabilityUrl);
    const events = (await cap.apiOne("events.get", { types: ["consent/request-cmc"], limit: 1 }, "events")) as Array<{
      content?: unknown;
    }>;
    if (!Array.isArray(events) || events.length !== 1) return null;
    return scopeFromOffer(events[0]?.content);
  } catch {
    return null;
  }
}
