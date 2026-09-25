/**
 * Outcome mapping for the `/cmc-scope-update` hand-off page, kept pure so the
 * wording and the id handed back to the calling app are unit-testable.
 */

import i18n from "../i18n";
import { platformError } from "./apiError";
import { GRANT_REQUIRES_OWNER_ID, grantRequiresOwnerMessage, isGrantRequiresOwner } from "./delegation";

/*
 * The functions below translate at call time. The `*_MESSAGE` constants are
 * the same texts in the language active when this module loaded, kept for
 * callers that compare against them.
 */

/** The platform could not find the request on the signed-in account. */
export const REQUEST_NOT_FOUND_MESSAGE = i18n.t("cmc.scopeRequestNotFound");

/** The wait ended before the platform recorded an outcome: not a failure. */
export const OUTCOME_UNKNOWN_MESSAGE = i18n.t("cmc.scopeOutcomeUnknown");

export const ALREADY_ANSWERED_MESSAGE = i18n.t("cmc.scopeAlreadyAnswered");

const NOT_FOUND_IDS = new Set(["cmc-scope-request-not-found", "unknown-resource"]);
// `cmc-capability-timeout` is what @pryv/cmc before 3.14 reports for the same situation.
const OUTCOME_UNKNOWN_IDS = new Set(["cmc-scope-update-outcome-unknown", "cmc-capability-timeout"]);

/**
 * The request's own record of how it was answered (`accepted` / `refused`),
 * as a message, or null while it is still open.
 */
export function answeredRequestMessage(status: unknown): string | null {
  if (status === "accepted") return i18n.t("cmc.scopeAlreadyAnsweredApproved");
  if (status === "refused") return i18n.t("cmc.scopeAlreadyAnsweredDeclined");
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
export function scopeUpdateFailure(err: unknown, fallback: string = i18n.t("cmc.scopeCouldNotComplete")): ScopeUpdateFailure {
  if (isGrantRequiresOwner(err)) {
    return { reason: GRANT_REQUIRES_OWNER_ID, message: grantRequiresOwnerMessage() };
  }
  const { id, message } = platformError(err, fallback);
  if (id != null && NOT_FOUND_IDS.has(id)) {
    return { reason: id, message: i18n.t("cmc.scopeRequestNotFound") };
  }
  if (id != null && OUTCOME_UNKNOWN_IDS.has(id)) {
    return { reason: id, message: i18n.t("cmc.scopeOutcomeUnknown") };
  }
  if (id === "cmc-scope-request-already-answered") {
    return { reason: id, message: i18n.t("cmc.scopeAlreadyAnswered") };
  }
  return { reason: id ?? message, message };
}

/**
 * Extra line under a successful approval, or null. The grant changed in both
 * cases; `peerNotified: false` only means the collector has not been told yet.
 */
export function scopeUpdateSuccessNote(result: { peerNotified?: boolean } | null | undefined): string | null {
  if (result?.peerNotified === false) {
    return i18n.t("cmc.scopePeerNotNotified");
  }
  return null;
}
