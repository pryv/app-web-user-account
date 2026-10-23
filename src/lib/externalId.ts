/**
 * External ids on an access request: a record in another service (a patient
 * file, a study enrolment) that the app asks to link to the account that
 * signs in.
 *
 * The request carries `externalId: { namespace, blindedValue, mode }`; the
 * NEED_SIGNIN poll gives it back with the namespace's display `label`. The
 * blinded value is a secret of the inviting service: it is kept in memory
 * only, sent in POST bodies only (never in a URL), never rendered and never
 * written to browser storage.
 *
 * - `lookupExternalId`: whether some account already holds the id (the
 *   register's `ext-id/cores`, no auth). It never says which account.
 * - `claimExternalId`: link the id to the signed-in account (personal token).
 */

import { loadAccessState } from "./accessFlow";
import { getAllowedPlatforms } from "./deployedSettings";
import { resolvePollPlatform } from "./pollPlatform";

/** The external id of a pending request, as the poll gives it. */
export interface RequestExternalId {
  namespace: string;
  /** The namespace's display name (the namespace itself when it has none). */
  label: string;
  blindedValue: string;
  /** "hint" (the user decides); "forced" is not offered yet and is treated as "hint". */
  mode: "hint" | "forced";
}

/** What the lookup said: held by an account, held by none, or could not be told. */
export type ExternalIdStatus = "claimed" | "unclaimed" | "unknown";

/** How a claim ended. */
export type ClaimOutcome =
  | "linked"
  | "value-taken"
  | "namespace-taken"
  | "rate-limited"
  | "failed";

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** The request's external id, or null without a usable one. */
export function externalIdOf(state: unknown): RequestExternalId | null {
  const raw = (state as { externalId?: unknown } | null)?.externalId as Record<string, unknown> | null | undefined;
  if (raw == null || typeof raw !== "object") return null;
  if (!nonEmpty(raw.namespace) || !nonEmpty(raw.blindedValue)) return null;
  return {
    namespace: raw.namespace,
    label: nonEmpty(raw.label) ? raw.label : raw.namespace,
    blindedValue: raw.blindedValue,
    mode: raw.mode === "forced" ? "forced" : "hint",
  };
}

/** The register URL with exactly one trailing slash, for appending a path. */
function withSlash(url: string): string {
  return url.replace(/\/+$/, "") + "/";
}

/**
 * Whether an account holds the id: `POST {register}ext-id/cores`. 200 is
 * "claimed", 404 "unclaimed" (an unknown namespace answers the same); anything
 * else, or no answer, is "unknown".
 */
export async function lookupExternalId(
  registerUrl: string,
  id: Pick<RequestExternalId, "namespace" | "blindedValue">,
  fetchImpl: typeof fetch = fetch,
): Promise<ExternalIdStatus> {
  try {
    const res = await fetchImpl(withSlash(registerUrl) + "ext-id/cores", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ namespace: id.namespace, blindedValue: id.blindedValue }),
    });
    if (res.status === 200) return "claimed";
    if (res.status === 404) return "unclaimed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Link the id to the account: `POST {endpoint}account/external-ids` with the
 * personal token. 201 (linked now) and 200 (already linked to this account)
 * are both "linked".
 */
export async function claimExternalId(
  endpoint: string,
  personalToken: string,
  id: Pick<RequestExternalId, "namespace" | "blindedValue">,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(withSlash(endpoint) + "account/external-ids", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: personalToken,
      },
      body: JSON.stringify({ namespace: id.namespace, blindedValue: id.blindedValue }),
    });
  } catch {
    return "failed";
  }
  if (res.status === 200 || res.status === 201) return "linked";
  if (res.status === 429) return "rate-limited";
  if (res.status === 409) {
    let reason: unknown = null;
    try {
      const body = (await res.json()) as { error?: { data?: { reason?: unknown } } };
      reason = body?.error?.data?.reason;
    } catch {
      // A non-JSON body: the status alone says the id cannot be linked here.
    }
    return reason === "namespace-taken" ? "namespace-taken" : "value-taken";
  }
  return "failed";
}

/**
 * The external id of the access request a page was reached with (`poll` in
 * its query), read again from the poll: the register page gets it this way
 * rather than through the URL, history state or browser storage. Null without
 * a pending request, without an external id, or when the request cannot be
 * read. On a deployment restricted to some platforms, the poll URL must
 * belong to one of them before anything is fetched from it, as on `/auth`.
 */
export async function requestExternalIdFromSearch(search: string): Promise<RequestExternalId | null> {
  const p = new URLSearchParams(search);
  const pollUrl = p.get("poll") ?? p.get("pollUrl");
  if (!pollUrl) return null;
  try {
    if (getAllowedPlatforms() != null) {
      const resolved = await resolvePollPlatform(pollUrl, p.get("pryvServiceInfoUrl") ?? p.get("serviceInfo"));
      if (resolved == null) return null;
    }
    const state = await loadAccessState(pollUrl);
    return state.status === "NEED_SIGNIN" ? externalIdOf(state) : null;
  } catch {
    return null;
  }
}

/** The `externalId` field of a registration body (no label: the server has its own). */
export function registrationExternalId(id: RequestExternalId): { namespace: string; blindedValue: string; mode: string } {
  return { namespace: id.namespace, blindedValue: id.blindedValue, mode: id.mode };
}
