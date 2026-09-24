/**
 * Outcome mapping for the `/cmc-accept` hand-off page, kept pure so the wording
 * and the id handed back to the calling app are unit-testable.
 */

import { cmcErrorIds as errorIds } from "./pryvClient";
import { platformError } from "./apiError";
import { GRANT_REQUIRES_OWNER_ID, GRANT_REQUIRES_OWNER_MESSAGE, isGrantRequiresOwner } from "./delegation";

/** Shown when the offer behind the link cannot be read (invalid or expired link, network). */
export const OFFER_UNREADABLE_MESSAGE =
  "This approval link could not be read: it may be invalid or expired. Ask the app that sent it for a new one.";

type Tone = "danger" | "info";

const OUTCOMES: Record<string, { message: string; tone: Tone }> = {
  [errorIds.CAPABILITY_INVALID]: {
    message: "This approval link is not valid, or it has expired. Ask the app that sent it for a new one.",
    tone: "danger",
  },
  [errorIds.CAPABILITY_CONSUMED]: {
    message:
      "This approval link has already been used: a single-use link can be approved only once. If you approved it yourself, the app already has its access.",
    tone: "info",
  },
  [errorIds.CAPABILITY_INVALIDATED]: { message: "The app that sent this request has withdrawn it.", tone: "danger" },
  [errorIds.CAPABILITY_ALREADY_ACCEPTED_BY_YOU]: { message: "You have already approved this request.", tone: "info" },
  // The wait ended before the platform recorded an outcome: not a failure.
  [errorIds.CAPABILITY_TIMEOUT]: {
    message: "The platform is still processing your approval. Check your connected apps in a moment; do not approve again.",
    tone: "info",
  },
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
    return { reason: GRANT_REQUIRES_OWNER_ID, message: GRANT_REQUIRES_OWNER_MESSAGE, tone: "danger" };
  }
  const { id, message } = platformError(err, fallback);
  const known = id != null ? OUTCOMES[id] : undefined;
  if (id != null && known != null) return { reason: id, ...known };
  return { reason: id ?? message, message, tone: "danger" };
}
