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

type Tone = "danger" | "info";

/** Known platform outcomes: the catalog key of what to show, and how to show it. */
const OUTCOMES: Record<string, { key: string; tone: Tone }> = {
  [errorIds.CAPABILITY_INVALID]: { key: "cmc.acceptLinkInvalid", tone: "danger" },
  [errorIds.CAPABILITY_CONSUMED]: { key: "cmc.acceptLinkConsumed", tone: "info" },
  [errorIds.CAPABILITY_INVALIDATED]: { key: "cmc.acceptWithdrawn", tone: "danger" },
  [errorIds.CAPABILITY_ALREADY_ACCEPTED_BY_YOU]: { key: "cmc.acceptAlreadyByYou", tone: "info" },
  // The wait ended before the platform recorded an outcome: not a failure.
  [errorIds.CAPABILITY_TIMEOUT]: { key: "cmc.acceptStillProcessing", tone: "info" },
};

export interface InviteFailure {
  /** Stable id handed back to the calling app (a platform error id when one exists). */
  reason: string;
  /** What the page shows. */
  message: string;
  /** How the page shows it: `info` when the outcome is not an error for the user. */
  tone: Tone;
}

/** Map an error from `acceptInvite` / `refuseInvite` to the id returned to the opener and the text shown. */
export function inviteFailure(err: unknown, fallback: string): InviteFailure {
  if (isGrantRequiresOwner(err)) {
    return { reason: GRANT_REQUIRES_OWNER_ID, message: grantRequiresOwnerMessage(), tone: "danger" };
  }
  const { id, message } = platformError(err, fallback);
  const known = id != null ? OUTCOMES[id] : undefined;
  if (id != null && known != null) return { reason: id, message: i18n.t(known.key), tone: known.tone };
  return { reason: id ?? message, message, tone: "danger" };
}
