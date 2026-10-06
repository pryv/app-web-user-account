/**
 * The account's email address, as a consent screen needs it: whether a
 * permission reads it, whether the account has a usable one, and the reads and
 * writes to check and add it.
 *
 * Why a heuristic. The platform requires an address at registration, so a
 * person who leaves the field empty gets one invented for them: this app's
 * registration page and the legacy auth app both fill in 20 random lowercase
 * letters and digits at `pryv.io`. The platform keeps no marker of that: a
 * typed address and an invented one read the same through `account.get`. The
 * invented shape is fixed and produced by code we own, so it is recognised by
 * its shape; one invented by another registration UI is not (the notice is
 * advisory: missing it leaves the screen as it was).
 */

import { Pryv } from "./pryvClient";
import { platformError } from "./apiError";
import type { OfferPermission } from "./consent";

/** The address this app and the legacy auth app invent when the email is left empty at registration. */
export const PLACEHOLDER_EMAIL = /^[a-z0-9]{20}@pryv\.io$/i;

/** The account's email stream, and its parent (a permission on the parent reads the email too). */
const EMAIL_STREAM_IDS = new Set([":system:email", ":_system:account"]);

/**
 * Whether these permissions read the account's email: a stream permission on
 * `:system:email` or on the whole `:_system:account`, at any level but `none`.
 * The star permission never covers account streams, and a feature permission
 * reads nothing.
 */
export function readsAccountEmail(permissions: readonly OfferPermission[] | null | undefined): boolean {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((p) => {
    if (p == null || typeof p !== "object" || !("streamId" in p)) return false;
    const { streamId, level } = p as { streamId?: unknown; level?: unknown };
    return typeof streamId === "string" && EMAIL_STREAM_IDS.has(streamId) && level !== "none";
  });
}

/** Whether the account has an address someone receives: not absent, not empty, not the invented one. */
export function hasUsableEmail(account: { email?: string | null } | null | undefined): boolean {
  const email = account?.email;
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  return trimmed !== "" && !PLACEHOLDER_EMAIL.test(trimmed);
}

/** The account's email, through `account.get` (a personal or delegate token). Throws when it cannot be read. */
export async function readAccountEmail(apiEndpoint: string): Promise<string | null> {
  const conn = new Pryv.Connection(apiEndpoint);
  // The client library types `account.get` params as `null`; the API expects an
  // (empty) object, as the profile page sends.
  const account = (await conn.apiOne("account.get", {} as unknown as null, "account")) as { email?: unknown } | null;
  return typeof account?.email === "string" ? account.email : null;
}

/**
 * Make `email` the account's address (`account.update`), the one a requester
 * reading the email gets. Unverified until the person confirms it from their
 * profile. Returns the address the account now holds. Throws on failure (see
 * `missingEmailErrorKey`).
 */
export async function setAccountEmail(apiEndpoint: string, email: string): Promise<string> {
  const conn = new Pryv.Connection(apiEndpoint);
  const account = (await conn.apiOne("account.update", { update: { email } }, "account")) as { email?: unknown } | null;
  // The account as the platform now holds it: that is what the requester reads.
  return typeof account?.email === "string" ? account.email : email;
}

/** The message key for a failed add: the address is taken, or anything else. */
export function missingEmailErrorKey(err: unknown): string {
  return platformError(err, "").id === "item-already-exists" ? "consent.emailTaken" : "consent.emailAddFailed";
}
