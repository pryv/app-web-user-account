/**
 * Outcome mapping for the `/cmc-accept` hand-off page, kept pure so the wording
 * and the id handed back to the calling app are unit-testable.
 */

import i18n from "../i18n";
import { cmcErrorIds as errorIds } from "./pryvClient";
import { platformError } from "./apiError";
import { GRANT_REQUIRES_OWNER_ID, grantRequiresOwnerMessage, isGrantRequiresOwner } from "./delegation";

/** Catalog key of the text shown when the offer behind the link cannot be read (invalid or expired link, network). */
export const OFFER_UNREADABLE_KEY = "cmc.acceptOfferUnreadable";

/**
 * The platform refused the approval because the approving account is the one
 * that created the invite (an account cannot consent to itself, e.g. an
 * open-link invite opened while signed in as its requester). Not yet in
 * `@pryv/cmc`'s `errorIds`, hence spelled out here.
 */
export const SELF_ACCEPT_FORBIDDEN_ID = "cmc-self-accept-forbidden";

type Tone = "danger" | "info";

interface Outcome {
  key: string;
  tone: Tone;
  /** Catalog key used instead of `key` when the approving account is known (`{{username}}`). */
  namedKey?: string;
  /**
   * Answering as another account is the way forward: catalog key (`{{username}}`)
   * used instead of `namedKey` when the page can offer to switch account.
   */
  switchKey?: string;
}

/** Known platform outcomes: the catalog key of what to show, and how to show it. */
const OUTCOMES: Record<string, Outcome> = {
  [errorIds.CAPABILITY_INVALID]: { key: "cmc.acceptLinkInvalid", tone: "danger" },
  [errorIds.CAPABILITY_CONSUMED]: { key: "cmc.acceptLinkConsumed", tone: "info" },
  [errorIds.CAPABILITY_INVALIDATED]: { key: "cmc.acceptWithdrawn", tone: "danger" },
  [errorIds.CAPABILITY_ALREADY_ACCEPTED_BY_YOU]: { key: "cmc.acceptAlreadyByYou", tone: "info" },
  // The wait ended before the platform recorded an outcome: not a failure.
  [errorIds.CAPABILITY_TIMEOUT]: { key: "cmc.acceptStillProcessing", tone: "info" },
  [SELF_ACCEPT_FORBIDDEN_ID]: {
    key: "cmc.acceptSelfForbidden",
    namedKey: "cmc.acceptSelfForbiddenAs",
    switchKey: "cmc.acceptSelfForbiddenSwitch",
    tone: "danger",
  },
};

export interface InviteFailure {
  /** Stable id handed back to the calling app (a platform error id when one exists). */
  reason: string;
  /** What the page shows. */
  message: string;
  /** How the page shows it: `info` when the outcome is not an error for the user. */
  tone: Tone;
  /** Set when the page said to switch account (it offers "Switch account" in place of the actions). */
  switchAccount?: true;
}

export interface InviteFailureContext {
  /** The account that answered, named in the text when the outcome is about it. */
  username?: string | null;
  /** The page can offer "Switch account": an outcome solved by another account says to use it. */
  canSwitchAccount?: boolean;
}

/** Map an error from `acceptInvite` / `refuseInvite` to the id returned to the opener and the text shown. */
export function inviteFailure(err: unknown, fallback: string, context: InviteFailureContext = {}): InviteFailure {
  if (isGrantRequiresOwner(err)) {
    return { reason: GRANT_REQUIRES_OWNER_ID, message: grantRequiresOwnerMessage(), tone: "danger" };
  }
  const { id, message } = platformError(err, fallback);
  const known = id != null ? OUTCOMES[id] : undefined;
  if (id == null || known == null) return { reason: id ?? message, message, tone: "danger" };
  const { username, canSwitchAccount = false } = context;
  if (username && known.switchKey != null && canSwitchAccount) {
    return { reason: id, message: i18n.t(known.switchKey, { username }), tone: known.tone, switchAccount: true };
  }
  const text = username && known.namedKey != null ? i18n.t(known.namedKey, { username }) : i18n.t(known.key);
  return { reason: id, message: text, tone: known.tone };
}
