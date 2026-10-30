/**
 * Account transfer: the beneficiary's side.
 *
 * When an account's automatic deletion is set to hand the account over, the
 * platform mails its beneficiary two links on the OWNER's core, each carrying
 * the owner's username and a one-time token: `/transfer-claim` and
 * `/transfer-decline`. The token is the credential, so both calls are public
 * (no access token) and go to the owner's API endpoint, with the trusted
 * `appId` like the email verification.
 *
 * Claiming is a three-step sequence. The first claim names the signed-in
 * account and the owner's core invites it as a delegate (`invited`); the
 * claimant accepts that invite on its OWN core (`delegations.acceptAttach`
 * with the owner's username); the second claim completes the transfer. A
 * first claim answering `completed` means it was already done. Each step is
 * idempotent, so a repeat after a partial failure is safe.
 *
 * The link's username and token wait in this tab's sessionStorage while the
 * beneficiary signs in or creates an account, never in the URL: `/signin`
 * reads `username` as a pre-fill hint, and a token in the address bar would
 * reach the history and the Referer.
 */

import i18n from "../i18n";
import { ApiCallError, postJson } from "./emailVerification";
import { delegationErrorId, delegationErrorMessage } from "./delegation";
import { isValidUsername } from "./username";

/** The owner's account and the mailed token. */
export interface TransferLink {
  owner: string;
  token: string;
}

export type TransferClaimStatus = "invited" | "completed";

/** Refusals of the claim and decline calls the pages explain in their own words. */
export const TRANSFER_ERRORS = {
  invalidLink: "auto-deletion-transfer-invalid-link",
  expired: "auto-deletion-transfer-expired",
  claimed: "auto-deletion-transfer-claimed",
  tooManyAttempts: "too-many-attempts",
} as const;

/** Refusals after which the link will never work: the stored link is dropped. */
const DEFINITIVE: ReadonlySet<string> = new Set([
  TRANSFER_ERRORS.invalidLink,
  TRANSFER_ERRORS.expired,
  TRANSFER_ERRORS.claimed,
]);

/** sessionStorage key of the pending claim (one per tab). */
export const CLAIM_STORAGE_KEY = "pryv-transfer-claim";

/**
 * The link's owner and token out of a query string, or null when either is
 * missing. Only a value that can be a username counts: the page shows it, so
 * a crafted link cannot put arbitrary text there.
 */
export function transferLinkFrom(search: string): TransferLink | null {
  const params = new URLSearchParams(search);
  const owner = params.get("username")?.trim().toLowerCase() ?? "";
  const token = params.get("token")?.trim() ?? "";
  if (token === "" || !isValidUsername(owner)) return null;
  return { owner, token };
}

/** The query string without the link's `username` and `token` (with its `?`, or ""). */
export function searchWithoutLink(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("username");
  params.delete("token");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function storeClaim(link: TransferLink): void {
  try {
    sessionStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify(link));
  } catch {
    // sessionStorage may be unavailable (private mode): the page still works
    // in this load, the link just does not survive the sign-in hop.
  }
}

export function readStoredClaim(): TransferLink | null {
  try {
    const raw = sessionStorage.getItem(CLAIM_STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<TransferLink> | null;
    if (typeof parsed?.owner !== "string" || typeof parsed.token !== "string") return null;
    if (!isValidUsername(parsed.owner) || parsed.token === "") return null;
    return { owner: parsed.owner, token: parsed.token };
  } catch {
    return null;
  }
}

export function clearStoredClaim(): void {
  try {
    sessionStorage.removeItem(CLAIM_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** POST {ownerApiEndpoint}account/auto-deletion/transfer-claim. */
export async function transferClaim(
  ownerApiEndpoint: string,
  appId: string,
  token: string,
  claimant: string,
): Promise<TransferClaimStatus> {
  const body = await postJson(ownerApiEndpoint + "account/auto-deletion/transfer-claim", { appId, token, claimant });
  const status = (body.transfer as { status?: unknown } | undefined)?.status;
  if (status !== "invited" && status !== "completed") {
    throw new ApiCallError(i18n.t("transfer.errors.generic"), { id: null, status: 200, data: body });
  }
  return status;
}

/** POST {ownerApiEndpoint}account/auto-deletion/transfer-decline. */
export async function transferDecline(ownerApiEndpoint: string, appId: string, token: string): Promise<void> {
  const body = await postJson(ownerApiEndpoint + "account/auto-deletion/transfer-decline", { appId, token });
  if (body.declined !== true) {
    throw new ApiCallError(i18n.t("transfer.errors.generic"), { id: null, status: 200, data: body });
  }
}

/**
 * Run the claim sequence for `claimant`: claim, accept the delegation invite
 * on the claimant's own core (`acceptAttach`), claim again. Resolves once the
 * transfer is completed.
 */
export async function runTransferClaim(opts: {
  ownerApiEndpoint: string;
  appId: string;
  link: TransferLink;
  claimant: string;
  acceptAttach: (owner: string) => Promise<unknown>;
  onStep?: (step: "claim" | "accept" | "complete") => void;
}): Promise<void> {
  const { ownerApiEndpoint, appId, link, claimant } = opts;
  opts.onStep?.("claim");
  const first = await transferClaim(ownerApiEndpoint, appId, link.token, claimant);
  if (first === "completed") return;
  opts.onStep?.("accept");
  await opts.acceptAttach(link.owner);
  opts.onStep?.("complete");
  const second = await transferClaim(ownerApiEndpoint, appId, link.token, claimant);
  if (second !== "completed") {
    throw new ApiCallError(i18n.t("transfer.errors.notCompleted"), { id: null, status: 200, data: null });
  }
}

/** The error id of a claim or decline failure (an API refusal or a delegation one). */
export function transferErrorId(err: unknown): string | null {
  if (err instanceof ApiCallError) return err.id;
  return delegationErrorId(err) ?? null;
}

/** Whether the link will never work after this failure. */
export function isDefinitiveRefusal(err: unknown): boolean {
  const id = transferErrorId(err);
  return id != null && DEFINITIVE.has(id);
}

/** The message a page shows for a claim or decline failure. */
export function transferErrorMessage(err: unknown): string {
  const id = transferErrorId(err);
  switch (id) {
    case TRANSFER_ERRORS.invalidLink:
      return i18n.t("transfer.errors.invalidLink");
    case TRANSFER_ERRORS.expired:
      return i18n.t("transfer.errors.expired");
    case TRANSFER_ERRORS.claimed:
      return i18n.t("transfer.errors.claimed");
    case TRANSFER_ERRORS.tooManyAttempts:
      return i18n.t("transfer.errors.tooManyAttempts");
  }
  if (id != null && id.startsWith("delegation-")) return delegationErrorMessage(err);
  if (err instanceof ApiCallError) return err.message || i18n.t("transfer.errors.generic");
  if (err instanceof Error && err.message) return err.message;
  return i18n.t("transfer.errors.generic");
}
