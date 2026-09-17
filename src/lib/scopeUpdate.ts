/**
 * Outcome mapping for the `/cmc-scope-update` hand-off page, kept pure so the
 * wording and the id handed back to the calling app are unit-testable.
 */

/** The platform could not find the request on the signed-in account. */
export const REQUEST_NOT_FOUND_MESSAGE =
  "This request could not be found on your account. The link may be stale, or it was built with the wrong request id.";

const NOT_FOUND_IDS = new Set(["cmc-scope-request-not-found", "unknown-resource"]);

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
  const id = errorId(err);
  const message = err instanceof Error && err.message ? err.message : fallback;
  if (id != null && NOT_FOUND_IDS.has(id)) {
    return { reason: id, message: REQUEST_NOT_FOUND_MESSAGE };
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

function errorId(err: unknown): string | null {
  if (err == null || typeof err !== "object") return null;
  const id = (err as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
