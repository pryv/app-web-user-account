/**
 * The app-supplied consent message carried on an access request.
 *
 * A requesting app puts a human-readable explanation of what it will do with
 * the data in `clientData["app-web-auth:description"]`. It is the only part of
 * the consent screen written by the app, and the only place the user reads
 * that explanation in their own language; the rest is an app id plus stream
 * names.
 *
 * One exported key and one exported reader, shared by the consent screen and
 * the audit view, so the two surfaces cannot drift apart again (the reader
 * used to exist only in the audit view, and the consent screen never showed
 * the message).
 */

/** clientData key carrying the app's consent message (markdown `note/txt`). */
export const CONSENT_KEY = "app-web-auth:description";

/**
 * Read the consent message out of an access request's `clientData`.
 *
 * Accepts a bare string and the `{ content }` object of the `note/txt`
 * clientData convention. Returns `null` when absent, empty or malformed, so
 * callers can simply omit the block.
 */
export function consentMessage(clientData?: Record<string, unknown> | null): string | null {
  const v = clientData?.[CONSENT_KEY];
  if (typeof v === "string") return v === "" ? null : v;
  if (v && typeof v === "object" && typeof (v as { content?: unknown }).content === "string") {
    const content = (v as { content: string }).content;
    return content === "" ? null : content;
  }
  return null;
}
