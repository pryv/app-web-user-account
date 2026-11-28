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
import { maskUrlCredentials } from "./maskCredentials";
import { emailBadge, type EmailView } from "./emailVerification";
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

/** The account's addresses: the one a requester reading the email gets, and every one it holds. */
export interface AccountEmails {
  email: string | null;
  emails: EmailView[];
  /**
   * The core's clock minus this device's, in seconds, as measured by the
   * client on the read (absent when the client does not say).
   */
  serverDelta?: number;
}

/**
 * The addresses of an `account.get` / `account.update` answer. A core that does
 * not list them (`emails`) is shown as holding the one address, not proved, as
 * on the profile page.
 */
function accountEmailsOf(account: unknown): AccountEmails {
  const { email, emails } = (account ?? {}) as { email?: unknown; emails?: unknown };
  const primary = typeof email === "string" ? email : null;
  if (Array.isArray(emails)) {
    return { email: primary, emails: emails.filter((e): e is EmailView => typeof (e as EmailView | null)?.value === "string") };
  }
  const only: EmailView[] =
    primary != null && primary !== ""
      ? [{ value: primary, primary: true, status: "verified", verifiedAt: null, verificationMethod: "registration" }]
      : [];
  return { email: primary, emails: only };
}

/** The account's primary address, if any. */
export function primaryEmailOf(account: AccountEmails): EmailView | null {
  return account.emails.find((e) => e.primary === true) ?? account.emails.find((e) => e.value === account.email) ?? null;
}

/** The account's entry for an address, whatever its case. */
export function emailEntry(account: AccountEmails, email: string): EmailView | null {
  return account.emails.find((e) => e.value.toLowerCase() === email.toLowerCase()) ?? null;
}

/** Whether the holder proved this address (see `emailBadge`). */
export function isProvedEmail(view: EmailView): boolean {
  return emailBadge(view) === "verified";
}

/**
 * When the next verification mail to this address can be asked for, on this
 * device's clock (epoch seconds): the core's `verificationCooldownUntil` is on
 * the core's clock, so `serverDelta` (the core's clock minus this device's,
 * see {@link AccountEmails}) moves it onto this one; a device running slow
 * then does not keep "Send again" off past the core's own end. Null when no
 * cooldown runs, or when the core does not say (older cores). The core's
 * `retryAfterSeconds` on a refused resend still decides.
 */
export function pendingCooldownUntil(
  view: EmailView | null,
  serverDelta = 0,
  nowSeconds = Date.now() / 1000,
): number | null {
  const until = view?.verificationCooldownUntil;
  if (typeof until !== "number" || !Number.isFinite(until)) return null;
  const local = until - (Number.isFinite(serverDelta) ? serverDelta : 0);
  return local > nowSeconds ? local : null;
}

/** The account's addresses, through `account.get` (a personal or delegate token). Throws when they cannot be read. */
export async function readAccountEmails(apiEndpoint: string): Promise<AccountEmails> {
  const conn = new Pryv.Connection(apiEndpoint);
  // The client library types `account.get` params as `null`; the API expects an
  // (empty) object, as the profile page sends.
  const account = accountEmailsOf(await conn.apiOne("account.get", {} as unknown as null, "account"));
  // Measured by the client from the answer's `meta.serverTime`.
  const delta = (conn as { deltaTime?: unknown }).deltaTime;
  return typeof delta === "number" && Number.isFinite(delta) ? { ...account, serverDelta: delta } : account;
}

type EmailsOperations = { add: string[] } | { resend: string[] } | { setPrimary: string } | { remove: string[] };

async function updateEmails(apiEndpoint: string, emails: EmailsOperations): Promise<AccountEmails> {
  const conn = new Pryv.Connection(apiEndpoint);
  // The client library types the legacy fields only.
  const params = { update: { emails } } as unknown as { update: { email?: string } };
  return accountEmailsOf(await conn.apiOne("account.update", params, "account"));
}

/** Add an address, not verified yet: the platform mails it a verification link. */
export function addAccountEmail(apiEndpoint: string, email: string): Promise<AccountEmails> {
  return updateEmails(apiEndpoint, { add: [email] });
}

/** Mail the verification link of one of the account's addresses again. */
export function resendVerificationEmail(apiEndpoint: string, email: string): Promise<AccountEmails> {
  return updateEmails(apiEndpoint, { resend: [email] });
}

/** Make one of the account's verified addresses its primary one. */
export function setPrimaryEmail(apiEndpoint: string, email: string): Promise<AccountEmails> {
  return updateEmails(apiEndpoint, { setPrimary: email });
}

/** Remove one of the account's addresses (never the primary one). */
export function removeAccountEmail(apiEndpoint: string, email: string): Promise<AccountEmails> {
  return updateEmails(apiEndpoint, { remove: [email] });
}

/**
 * Make `email` the account's address (`account.update`), the one a requester
 * reading the email gets. Unverified until the person confirms it from their
 * profile. Returns the address the account now holds. Throws on failure (see
 * `emailRefusal`).
 */
export async function setAccountEmail(apiEndpoint: string, email: string): Promise<string> {
  const conn = new Pryv.Connection(apiEndpoint);
  const account = (await conn.apiOne("account.update", { update: { email } }, "account")) as { email?: unknown } | null;
  // The account as the platform now holds it: that is what the requester reads.
  return typeof account?.email === "string" ? account.email : email;
}

/** A refused call on the account's addresses: what the page acts on, and a message it may show. */
export interface EmailRefusal {
  /** Another account holds the address. */
  taken: boolean;
  /** When the platform says how long to wait before the next mail. */
  retryAfterSeconds: number | null;
  /** The limit is one the platform counts on the account, not one mail just sent. */
  limited: boolean;
  /** The platform's message, credentials masked. */
  message: string;
}

/** What a refused call on the account's addresses says. */
export function emailRefusal(err: unknown, fallback: string): EmailRefusal {
  const { id, message } = platformError(err, fallback);
  const data = (err as { innerObject?: { data?: { retryAfterSeconds?: unknown } } } | null)?.innerObject?.data;
  const wait = data?.retryAfterSeconds;
  return {
    taken: id === "item-already-exists",
    retryAfterSeconds: typeof wait === "number" && Number.isFinite(wait) && wait > 0 ? wait : null,
    limited: id === "too-many-attempts",
    message: maskUrlCredentials(message),
  };
}
