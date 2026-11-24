import type { PryvConnection } from "./sessionStore";

/*
 * Changing the account's username (`account.changeUsername`) and how many
 * changes are left (`account.usernameChanges`). Both need a personal session.
 * A former username keeps routing to the account, so the apps already
 * connected keep working; the new name is the one to sign in with.
 */

export interface UsernameChanges {
  used: number;
  limit: number;
  remaining: number;
}

/** One step of a change that did not complete; the change stands. */
export interface UsernameChangeWarning {
  step: string;
  message: string;
}

/** Why a change was refused, for a message in the UI language. */
export type UsernameChangeRefusal = "taken" | "reserved" | "limit" | "same" | "format" | "personal" | "other";

export class UsernameChangeError extends Error {
  readonly refusal: UsernameChangeRefusal;
  constructor(refusal: UsernameChangeRefusal, message: string) {
    super(message);
    this.name = "UsernameChangeError";
    this.refusal = refusal;
  }
}

interface ApiErrorLike {
  id?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * The change counts, or null when the platform does not answer them (a core
 * without username changes, or a session that is not personal): the page then
 * offers no change.
 */
export async function getUsernameChanges(connection: PryvConnection): Promise<UsernameChanges | null> {
  try {
    const [res] = (await connection.api([{ method: "account.usernameChanges", params: {} }])) as Array<{
      usernameChangesUsed?: number;
      usernameChangesLimit?: number;
      usernameChangesRemaining?: number;
      error?: ApiErrorLike;
    }>;
    if (res == null || res.error != null) return null;
    const { usernameChangesUsed: used, usernameChangesLimit: limit, usernameChangesRemaining: remaining } = res;
    if (typeof used !== "number" || typeof limit !== "number" || typeof remaining !== "number") return null;
    return { used, limit, remaining };
  } catch {
    return null;
  }
}

/** Reads a refusal of `account.changeUsername` (see its error answers). */
export function refusalOf(error: ApiErrorLike): UsernameChangeRefusal {
  const data = error.data ?? {};
  switch (error.id) {
    case "item-already-exists":
      return "taken";
    case "invalid-parameters-format":
      return "format";
    case "forbidden":
      return "personal";
    case "invalid-operation":
      if (typeof data.usernameChangesLimit === "number") return "limit";
      if (typeof data.newUsername === "string") return "reserved";
      if (/identical/i.test(error.message ?? "")) return "same";
      return "other";
    default:
      return "other";
  }
}

export interface UsernameChanged {
  username: string;
  remaining: number;
  warnings: UsernameChangeWarning[];
}

/** Changes the username; throws a `UsernameChangeError` when refused. */
export async function changeUsername(connection: PryvConnection, newUsername: string): Promise<UsernameChanged> {
  const [res] = (await connection.api([
    { method: "account.changeUsername", params: { newUsername } },
  ])) as Array<{
    account?: { username?: string };
    usernameChangesRemaining?: number;
    warnings?: UsernameChangeWarning[];
    error?: ApiErrorLike;
  }>;
  if (res?.error != null) {
    throw new UsernameChangeError(refusalOf(res.error), res.error.message ?? "");
  }
  return {
    username: res?.account?.username ?? newUsername,
    remaining: typeof res?.usernameChangesRemaining === "number" ? res.usernameChangesRemaining : 0,
    warnings: Array.isArray(res?.warnings) ? res.warnings : [],
  };
}

/**
 * The session's API endpoint under the new username, same token, built from
 * the platform's endpoint pattern. Null when it cannot be built: the session
 * then keeps its endpoint, which still routes under the former name.
 */
export async function endpointForUsername(connection: PryvConnection, username: string): Promise<string | null> {
  try {
    const token = decodeURIComponent(new URL(connection.apiEndpoint).username);
    if (!token) return null;
    const service = connection.service as unknown as {
      apiEndpointFor?: (username: string, token: string) => Promise<string>;
    };
    if (typeof service.apiEndpointFor !== "function") return null;
    const endpoint = await service.apiEndpointFor(username, token);
    return typeof endpoint === "string" && endpoint.length > 0 ? endpoint : null;
  } catch {
    return null;
  }
}
