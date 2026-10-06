/**
 * Reads the platform error out of what the Pryv client libraries throw.
 *
 * `@pryv/cmc` throws a `CmcError` with its id on `id`. `pryv`'s
 * `Connection.apiOne` throws a `PryvError` with the API error in `innerObject`
 * and, for a refusal raised by a plugin, its specific id under
 * `innerObject.data.id`. Before `pryv` 3.14.2 its own message embedded the
 * call's params (which may carry a token-bearing URL), so it is never shown.
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

/**
 * A one-line description of an error, safe to log: its platform id and
 * message (as `platformError` reads them), with anything that looks like a URL
 * or a `token@host` part replaced. Log this, never the error object itself:
 * its fields (or a message from an older client) may carry a token-bearing
 * endpoint or capability URL.
 */
export function loggableError(err: unknown): string {
  const { id, message } = platformError(err, typeof err === "string" ? err : "unknown error");
  const text = redactUrls(message);
  return id != null ? redactUrls(id) + ": " + text : text;
}

/** Longest part of a message `redactUrls` looks at (it may come from a remote platform, unbounded). */
const MAX_SCANNED_LENGTH = 2000;

/**
 * `text` with URLs and `userinfo@host` parts replaced, cut at 300 characters.
 * For logs: nothing of the endpoint is kept. On screen, `maskCredentials` in
 * `src/lib/maskCredentials.ts` keeps the host and path and masks only the
 * token; the two contracts differ on purpose.
 * The text is cut before matching and every quantifier that can backtrack is
 * bounded, so a hostile message costs linear time.
 */
export function redactUrls(text: string): string {
  return text
    .slice(0, MAX_SCANNED_LENGTH)
    .replace(/[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]*/gi, "<url>")
    .replace(/[^\s"'<>@/:]{1,512}@[a-z0-9-][^\s"'<>]*/gi, "<redacted>")
    .slice(0, 300);
}

function field(value: unknown, key: string): unknown {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
