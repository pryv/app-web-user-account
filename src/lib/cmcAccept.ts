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
  /** Answering as another account is the way forward: the page offers to switch account. */
  switchAccount?: true;
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
    tone: "danger",
    switchAccount: true,
  },
};

export interface InviteFailure {
  /** Stable id handed back to the calling app (a platform error id when one exists). */
  reason: string;
  /** What the page shows. */
  message: string;
  /** How the page shows it: `info` when the outcome is not an error for the user. */
  tone: Tone;
  /** Set when the way forward is to answer as another account (the page offers "Switch account"). */
  switchAccount?: true;
}

/**
 * Map an error from `acceptInvite` / `refuseInvite` to the id returned to the opener and the text shown.
 * `username` is the account that answered, named in the text when the outcome is about it.
 */
export function inviteFailure(err: unknown, fallback: string, username?: string | null): InviteFailure {
  if (isGrantRequiresOwner(err)) {
    return { reason: GRANT_REQUIRES_OWNER_ID, message: grantRequiresOwnerMessage(), tone: "danger" };
  }
  const { id, message } = platformError(err, fallback);
  const known = id != null ? OUTCOMES[id] : undefined;
  if (id != null && known != null) {
    const message =
      known.namedKey != null && username ? i18n.t(known.namedKey, { username }) : i18n.t(known.key);
    const failure: InviteFailure = { reason: id, message, tone: known.tone };
    if (known.switchAccount) failure.switchAccount = true;
    return failure;
  }
  return { reason: id ?? message, message, tone: "danger" };
}
