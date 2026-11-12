/**
 * The class of an API method, as the access page's activity chart and the
 * Audit trail's kind filter count and select calls. The core classifies the
 * per-access `usage` counters on `accesses.get` with the same rules; the
 * shared fixture in `methodClasses.test.ts` pins both.
 *
 * Rules, in order, first match wins (`last` is the segment after the last
 * dot; a method without a dot is its own `last`):
 * 1. `callBatch` is `batch`: the envelope of a batch, whose inner calls are
 *    audited one by one. Never counted, never charted.
 * 2. `auth.*`, `mfa.*`, `oauth.*`, `sso.*` are `session`.
 * 3. `read` when `last` starts with `get`, `list`, `check` or `retrieve`, or is
 *    `info`, `usernameChanges`, `controlledStatus`, `extIdHolds` or
 *    `getAccessInfo`.
 * 4. `write` when `last` starts with `create`, `update`, `delete`, `set`,
 *    `replace`, `claim`, `release`, `change`, `accept`, `refuse`, `cancel`,
 *    `detach`, `dismiss`, `issue`, `notify`, `request`, `reset`, `verify`,
 *    `test`, `transfer`, `deactivate` or `erase`, or is `adminRelease` or
 *    `extIdRelease`.
 * 5. Anything else is `other`.
 *
 * A failed call keeps its method's class: an error is a row type
 * (`audit-log/pryv-api-error`), not a class.
 */

/** The public classes (`batch` is never counted). */
export const METHOD_CLASSES = ["read", "write", "session", "other"] as const;
export type MethodClass = (typeof METHOD_CLASSES)[number];

const SESSION = /^(auth|mfa|oauth|sso)\./;
const READ_PREFIXES = ["get", "list", "check", "retrieve"];
const READ_NAMES = new Set(["info", "usernameChanges", "controlledStatus", "extIdHolds", "getAccessInfo"]);
const WRITE_PREFIXES = [
  "create",
  "update",
  "delete",
  "set",
  "replace",
  "claim",
  "release",
  "change",
  "accept",
  "refuse",
  "cancel",
  "detach",
  "dismiss",
  "issue",
  "notify",
  "request",
  "reset",
  "verify",
  "test",
  "transfer",
  "deactivate",
  "erase",
];
const WRITE_NAMES = new Set(["adminRelease", "extIdRelease"]);

export function classifyMethod(methodId: string): MethodClass | "batch" {
  if (methodId === "callBatch") return "batch";
  if (SESSION.test(methodId)) return "session";
  const last = methodId.slice(methodId.lastIndexOf(".") + 1);
  if (READ_NAMES.has(last) || READ_PREFIXES.some((p) => last.startsWith(p))) return "read";
  if (WRITE_NAMES.has(last) || WRITE_PREFIXES.some((p) => last.startsWith(p))) return "write";
  return "other";
}
