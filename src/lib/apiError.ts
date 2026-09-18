/**
 * Reads the platform error out of what the Pryv client libraries throw.
 *
 * `@pryv/cmc` throws a `CmcError` with its id on `id`. `pryv`'s
 * `Connection.apiOne` throws a `PryvError` whose own message embeds the call's
 * params (which may carry a token-bearing URL), with the API error in
 * `innerObject` and, for a refusal raised by a plugin, its specific id under
 * `innerObject.data.id`.
 */

export interface PlatformError {
  /** Most specific platform error id, or null. */
  id: string | null;
  /** Message safe to show: the API error's own message rather than the client wrapper's. */
  message: string;
}

export function platformError(err: unknown, fallback: string): PlatformError {
  const inner = field(err, "innerObject");
  const id = [field(field(inner, "data"), "id"), field(inner, "id"), field(err, "id")].find(isNonEmptyString) ?? null;
  const innerMessage = field(inner, "message");
  if (isNonEmptyString(innerMessage)) return { id, message: innerMessage };
  if (inner != null) return { id, message: fallback };
  const message = err instanceof Error && err.message ? err.message : fallback;
  return { id, message };
}

function field(value: unknown, key: string): unknown {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
