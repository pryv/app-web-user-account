/**
 * Outcome mapping for the `/cmc-scope-update` hand-off page, kept pure so the
 * wording and the id handed back to the calling app are unit-testable.
 */

import { platformError } from "./apiError";
import { GRANT_REQUIRES_OWNER_ID, GRANT_REQUIRES_OWNER_MESSAGE, isGrantRequiresOwner } from "./delegation";

/** The platform could not find the request on the signed-in account. */
export const REQUEST_NOT_FOUND_MESSAGE =
  "This request could not be found on your account. The link may be stale, or it was built with the wrong request id.";

/** The wait ended before the platform recorded an outcome: not a failure. */
export const OUTCOME_UNKNOWN_MESSAGE =
  "The platform is still processing your answer. Check your connected apps in a moment; do not answer again.";

export const ALREADY_ANSWERED_MESSAGE = "You have already answered this request.";

const NOT_FOUND_IDS = new Set(["cmc-scope-request-not-found", "unknown-resource"]);
// `cmc-capability-timeout` is what @pryv/cmc before 3.14 reports for the same situation.
const OUTCOME_UNKNOWN_IDS = new Set(["cmc-scope-update-outcome-unknown", "cmc-capability-timeout"]);

/**
 * The request's own record of how it was answered (`accepted` / `refused`),
 * as a message, or null while it is still open.
 */
export function answeredRequestMessage(status: unknown): string | null {
  if (status === "accepted") return `${ALREADY_ANSWERED_MESSAGE} It was approved.`;
  if (status === "refused") return `${ALREADY_ANSWERED_MESSAGE} It was declined.`;
  return null;
}

export interface ScopeUpdateFailure {
  /** Stable id handed back to the calling app (a CMC error id when one exists). */
  reason: string;
  /** What the page shows. */
  message: string;
}

/**
 * Map an error from `acceptScopeUpdate` / `refuseScopeUpdate` (or from loading
 * the request) to the id returned to the opener and the text shown.
 */
export function scopeUpdateFailure(err: unknown, fallback = "Could not complete the request."): ScopeUpdateFailure {
  if (isGrantRequiresOwner(err)) {
    return { reason: GRANT_REQUIRES_OWNER_ID, message: GRANT_REQUIRES_OWNER_MESSAGE };
  }
  const { id, message } = platformError(err, fallback);
  if (id != null && NOT_FOUND_IDS.has(id)) {
    return { reason: id, message: REQUEST_NOT_FOUND_MESSAGE };
  }
  if (id != null && OUTCOME_UNKNOWN_IDS.has(id)) {
    return { reason: id, message: OUTCOME_UNKNOWN_MESSAGE };
  }
  if (id === "cmc-scope-request-already-answered") {
    return { reason: id, message: ALREADY_ANSWERED_MESSAGE };
  }
  return { reason: id ?? message, message };
}

/**
 * Extra line under a successful approval, or null. The grant changed in both
 * cases; `peerNotified: false` only means the collector has not been told yet.
 */
export function scopeUpdateSuccessNote(result: { peerNotified?: boolean } | null | undefined): string | null {
  if (result?.peerNotified === false) {
    return "The collector could not be notified yet; the platform will retry.";
  }
  return null;
}
