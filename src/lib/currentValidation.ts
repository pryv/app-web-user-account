/**
 * Who vouches for the apps the account granted, as of now: the core's
 * `POST /oauth2/clients/validation` (open-pryv.io with the route), asked with
 * the session's personal token. The account screens show it beside the level
 * stamped at consent (`clientData.oauth.client.validation.level`) and tell
 * the user when the app lost its validation or is no longer served since.
 *
 * The core answers only for the clients the account's accesses were minted
 * for. A core without the route (404), a token it refuses (a delegate's
 * session) or any other failure: no answer, nothing shown, no error.
 */

import { useEffect, useState } from "react";
import type { PryvConnection } from "./sessionStore";
import { parseClientValidation, type ClientValidation, type ValidationLevel } from "./oauth2Flow";

/** At most this many client ids per request (the core's bound). */
export const MAX_CLIENT_IDS_PER_REQUEST = 50;

/** The current level of a client, and whether the platform serves it now. */
export interface CurrentValidation extends ClientValidation {
  /** False when the platform refuses the app now (suspended, under review, or refused at its level). */
  served: boolean;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** The answer for one client, read tolerantly: anything malformed is no answer. */
function parseCurrent(v: unknown): CurrentValidation | null {
  const validation = parseClientValidation(v);
  const served = (v as { served?: unknown } | null)?.served;
  if (validation == null || typeof served !== "boolean") return null;
  return { ...validation, served };
}

/**
 * The current validation of `clientIds` (stored client ids, as the accesses
 * are named: `oauth-grant:<id>`, `oauth:<id>`), keyed by client id; a client
 * the core does not answer for is absent. Null when the core gives no answer.
 */
export async function fetchCurrentValidation(opts: {
  apiEndpoint: string;
  username: string;
  clientIds: string[];
  fetchFn?: FetchLike;
}): Promise<Map<string, CurrentValidation> | null> {
  const ids = [...new Set(opts.clientIds)];
  const out = new Map<string, CurrentValidation>();
  if (ids.length === 0) return out;
  let origin: string;
  let token: string;
  try {
    const u = new URL(opts.apiEndpoint);
    origin = u.origin;
    token = decodeURIComponent(u.username);
  } catch {
    return null;
  }
  if (token === "") return null;
  const doFetch: FetchLike = opts.fetchFn ?? ((url, init) => fetch(url, init));
  try {
    for (let i = 0; i < ids.length; i += MAX_CLIENT_IDS_PER_REQUEST) {
      const res = await doFetch(origin + "/oauth2/clients/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: opts.username, userToken: token, clientIds: ids.slice(i, i + MAX_CLIENT_IDS_PER_REQUEST) }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { clients?: unknown };
      if (json?.clients == null || typeof json.clients !== "object" || Array.isArray(json.clients)) return null;
      for (const [id, v] of Object.entries(json.clients as Record<string, unknown>)) {
        const current = parseCurrent(v);
        if (current != null) out.set(id, current);
      }
    }
  } catch {
    return null;
  }
  return out;
}

/** The current validation of the account's apps, loaded once per connection and id list; null until (or without) an answer. */
export function useCurrentValidation(
  connection: PryvConnection | null,
  clientIds: string[],
): Map<string, CurrentValidation> | null {
  const key = [...new Set(clientIds)].sort().join("\n");
  const [state, setState] = useState<{ key: string; connection: PryvConnection | null; value: Map<string, CurrentValidation> | null }>(
    { key: "", connection: null, value: null },
  );
  useEffect(() => {
    if (connection == null || key === "") return;
    let cancelled = false;
    void (async () => {
      let value: Map<string, CurrentValidation> | null = null;
      try {
        const username = await connection.username();
        value = await fetchCurrentValidation({ apiEndpoint: connection.apiEndpoint, username, clientIds: key.split("\n") });
      } catch {
        value = null;
      }
      if (!cancelled) setState({ key, connection, value });
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, key]);
  // An answer for another account or another list is never shown.
  return state.key === key && state.connection === connection ? state.value : null;
}

const RANK: Record<ValidationLevel, number> = { nonValidated: 0, publisherValidated: 1, appValidated: 2 };

/** What changed since consent, for the notice: not served now, a lower level, a higher one, or nothing. */
export type ValidationChange = "notServed" | "lowered" | "raised" | null;

export function validationChange(stamped: ValidationLevel | null, current: CurrentValidation | null): ValidationChange {
  if (current == null) return null;
  if (!current.served) return "notServed";
  if (stamped == null || stamped === current.level) return null;
  return RANK[current.level] < RANK[stamped] ? "lowered" : "raised";
}

const LEVELS: readonly string[] = ["nonValidated", "publisherValidated", "appValidated"];

/** The level stamped at consent on an access (`clientData.oauth.client.validation.level`), or null. */
export function stampedValidationLevel(access: { clientData?: Record<string, unknown> | null } | null | undefined): ValidationLevel | null {
  const oauth = access?.clientData?.oauth as { client?: { validation?: { level?: unknown } } } | undefined;
  const level = oauth?.client?.validation?.level;
  return typeof level === "string" && LEVELS.includes(level) ? (level as ValidationLevel) : null;
}
