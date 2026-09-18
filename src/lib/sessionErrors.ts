/**
 * Tells a rejected session apart from a failure to reach the platform.
 *
 * A stored session is only dropped when the platform said its token is no
 * longer good (revoked, expired, or not allowed): HTTP 401/403, or the API
 * error ids `invalid-access-token` / `forbidden`. A network error or a 5xx
 * says nothing about the token, so the session is kept and the user retries.
 */

const REJECTED_IDS = new Set(["invalid-access-token", "forbidden"]);
const REJECTED_STATUSES = new Set([401, 403]);

interface ErrorShape {
  id?: unknown;
  status?: unknown;
  innerObject?: { id?: unknown } | null;
  response?: { status?: unknown; body?: { error?: { id?: unknown } } | null } | null;
}

/** True when `err` means the platform rejected the session's token. */
export function isSessionRejected(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as ErrorShape;
  const ids = [e.id, e.innerObject?.id, e.response?.body?.error?.id];
  if (ids.some((id) => typeof id === "string" && REJECTED_IDS.has(id))) return true;
  const statuses = [e.status, e.response?.status];
  return statuses.some((s) => typeof s === "number" && REJECTED_STATUSES.has(s));
}
