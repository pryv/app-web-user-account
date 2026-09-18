/**
 * Helpers for the legacy access-request flow served at `/auth`.
 *
 * Mirrors the contract implemented in app-web-auth3's `Authorization.vue` +
 * its `ops/*` files. The flow has three external API touchpoints:
 *
 *   1. GET  pollUrl                                 — load access state (status,
 *                                                     requested permissions,
 *                                                     returnURL, …)
 *   2. POST {apiEndpoint}/accesses/check-app        — server-side check whether
 *                                                     a matching access exists +
 *                                                     fold defaultName/clientData
 *   3. POST {apiEndpoint}/accesses                  — create the app access
 *      (DELETE {apiEndpoint}/accesses/{id} when
 *      a `mismatchingAccess` must be replaced)
 *   4. POST pollUrl                                 — notify register of the
 *                                                     final state (ACCEPTED /
 *                                                     REFUSED)
 *
 * All four use the user's personal token (obtained via `Service.login`).
 */

import { httpUrlOrNull } from "./safeRedirect";

export interface Permission {
  streamId?: string;
  level?: "read" | "contribute" | "manage";
  defaultName?: string;
  name?: string;
}

export interface AppAccess {
  id: string;
  token: string;
  type: "app";
  permissions: Permission[];
  clientData?: Record<string, unknown> | null;
}

export interface AppCheck {
  checkedPermissions?: Permission[];
  matchingAccess?: AppAccess | null;
  mismatchingAccess?: AppAccess | null;
}

export interface AccessState {
  status?: "NEED_SIGNIN" | "ACCEPTED" | "REFUSED" | "REDIRECTED" | "ERROR";
  requestingAppId?: string;
  requestedPermissions?: Permission[];
  deviceName?: string;
  token?: string;
  expireAfter?: number;
  clientData?: Record<string, unknown>;
  returnURL?: string | null;
  oauthState?: string;
  key?: string;
  serviceInfo?: Record<string, unknown>;
  reasonId?: string;
  message?: string;
  apiEndpoint?: string;
  username?: string;
  redirectUrl?: string;
  lang?: string;
  /**
   * The consent form, present only when the app created its request with a
   * `consent` sidecar AND the server understood it. Absent means the older
   * contract: the whole permission set, all or nothing.
   *
   * `permissions` here are the SAME entries as `requestedPermissions`, with
   * the consent-layer annotations added, so the screen can open each row in
   * the right state and the accept can send a subset.
   */
  consent?: {
    allowUserChoice?: boolean;
    permissions: Permission[];
  };
  /**
   * Who the app wants the access for: "allow" (the user may pick an account
   * they control), "deny" (the signed-in account only) or a username to
   * preselect. Absent: as "allow".
   */
  actAs?: string;
  /** Display hint posted with ACCEPTED when granted on a controlled account. */
  delegation?: {
    isDelegatedAccess: true;
    controlledUsername: string;
    delegate: { username: string; hostSlug?: string };
  };
  /**
   * Delivery mode the request asked for, echoed on the NEED_SIGNIN poll. When
   * "shared-secret" this page may hand the credential off through a one-time
   * secret (shape H) instead of posting the token inline (shape L), so the
   * token never reaches the core that answered the request.
   */
  credentialHandoff?: "shared-secret";
  /**
   * One-time hand-off descriptor posted with ACCEPTED (shape H), in place of
   * the token. Never posted together with a token.
   */
  handoff?: { type: "shared-secret"; key: string };
}

/** A failed poll-URL read; `status` is the HTTP status. */
export class AccessStateLoadError extends Error {
  status: number;
  constructor(status: number) {
    super("Invalid data from Access server (" + status + ")");
    this.status = status;
  }
}

/** Fetch the access-state JSON from the registration server's poll URL. */
export async function loadAccessState(pollUrl: string): Promise<AccessState> {
  const res = await fetch(pollUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new AccessStateLoadError(res.status);
  return (await res.json()) as AccessState;
}

/** What the register answered to an ACCEPTED / REFUSED post. The body
 * matters when the server checked the grant and refused it: it carries the
 * reason, and which of `invalid-consent-grant` (the grant is wrong) or
 * `consent-check-unavailable` (the server could not check) it was. */
export interface AccessStateUpdateResult {
  status: number;
  errorId?: string;
  reason?: string;
}

/**
 * Notify register of the final access state (ACCEPTED / REFUSED). Errors are
 * surfaced but `closeOrRedirect` runs in `finally` either way per the legacy
 * contract.
 */
export async function updateAccessState(
  pollUrl: string,
  state: Partial<AccessState>,
): Promise<AccessStateUpdateResult> {
  const res = await fetch(pollUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(state),
  });
  if (res.ok) return { status: res.status };
  try {
    const body = (await res.json()) as { error?: { id?: string; data?: { reason?: string } } };
    return { status: res.status, errorId: body?.error?.id, reason: body?.error?.data?.reason };
  } catch {
    // A non-JSON error body tells us nothing more than the status did.
    return { status: res.status };
  }
}

/**
 * Server-side check-app: returns matching/mismatching access info and
 * folded `checkedPermissions` (with defaultName resolved).
 */
export async function checkAppAccess(
  apiEndpoint: string,
  personalToken: string,
  checkData: {
    requestingAppId: string;
    requestedPermissions: Permission[];
    deviceName?: string;
    token?: string;
    expireAfter?: number;
    clientData?: Record<string, unknown>;
  },
): Promise<AppCheck> {
  const res = await fetch(apiEndpoint.replace(/\/$/, "") + "/accesses/check-app", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: personalToken,
    },
    body: JSON.stringify(checkData),
  });
  if (!res.ok) throw new Error("check-app failed (" + res.status + ")");
  return (await res.json()) as AppCheck;
}

export async function createAppAccess(
  apiEndpoint: string,
  personalToken: string,
  request: {
    name: string;
    type: "app";
    permissions: Permission[];
    deviceName?: string;
    token?: string;
    expireAfter?: number;
    clientData?: Record<string, unknown>;
  },
): Promise<AppAccess> {
  const res = await fetch(apiEndpoint.replace(/\/$/, "") + "/accesses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: personalToken,
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("create access failed (" + res.status + "): " + body.slice(0, 200));
  }
  const body = (await res.json()) as { access?: AppAccess };
  if (!body.access) throw new Error("create access: server returned no access");
  return body.access;
}

export async function deleteAppAccess(
  apiEndpoint: string,
  personalToken: string,
  accessId: string,
): Promise<void> {
  const res = await fetch(
    apiEndpoint.replace(/\/$/, "") + "/accesses/" + encodeURIComponent(accessId),
    {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: personalToken },
    },
  );
  if (!res.ok) {
    throw new Error("delete access failed (" + res.status + ")");
  }
}

/**
 * After accept/refuse, either close the popup or redirect to returnURL.
 * Mirrors app-web-auth3's `ops/close_or_redirect.js` exactly:
 *
 *   - REDIRECTED status → follow redirectUrl (multi-core handoff).
 *   - no returnURL → window.close().
 *   - oauthState present → appendparams: state=<oauthState>&code=<key>&poll=<pollUrl>.
 *   - else → append `prYvpoll=<pollUrl>` + `prYv<each scalar accessState field>=<value>`
 *           (legacy convention; lib-js's consumer reads both prYvpoll and
 *           the modern pryvPoll since the dual-form back-compat shipped in
 *           lib-js bcf56ea — produces the legacy form for compatibility).
 */
export function closeOrRedirect(
  pollUrl: string,
  state: AccessState,
  cli: boolean,
): void {
  if (cli) {
    renderCliTerminalMessage();
    return;
  }
  if (state.status === "REDIRECTED" && state.redirectUrl) {
    // Fail closed: only follow a valid http(s) multi-core handoff target. A
    // non-http(s) scheme (javascript:/data:) would execute in the auth origin.
    const safe = httpUrlOrNull(state.redirectUrl);
    if (safe) {
      window.location.href = safe.href;
      return;
    }
    // Invalid redirectUrl → drop to the normal completion path below.
  }
  const returnURL = state.returnURL;
  if (!returnURL || returnURL === "false") {
    window.close();
    return;
  }
  // `returnURL` is query-supplied; reject a non-http(s) scheme (open-redirect /
  // javascript:-scheme XSS) before building + assigning the completion URL.
  if (!httpUrlOrNull(returnURL)) {
    window.close();
    return;
  }
  let url = returnURL;
  if (!url.endsWith("?")) url += "?";
  if (state.oauthState) {
    const code = state.key ? "&code=" + encodeURIComponent(state.key) : "";
    url +=
      "state=" + encodeURIComponent(state.oauthState) + code + "&poll=" + encodeURIComponent(pollUrl);
  } else {
    url += "prYvpoll=" + encodeURIComponent(pollUrl);
    for (const [k, v] of Object.entries(state)) {
      if (typeof v === "string" || typeof v === "number") {
        url += "&prYv" + k + "=" + encodeURIComponent(String(v));
      }
    }
  }
  window.location.href = url;
}

function renderCliTerminalMessage(): void {
  document.title = "Logged in";
  const root = document.getElementById("root") || document.body;
  root.innerHTML =
    '<div style="font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2em; text-align: center; font-size: 1.25em; color: #333;">' +
    "You're successfully signed in. You can close this window." +
    "</div>";
}

/** Default life of a hand-off secret, seconds. The account's core caps it at
 * its `sharedSecrets.maxTtl` (30 days by default), well above this. */
export const HANDOFF_TTL_SECONDS = 600;

/**
 * Build the ACCEPTED payload, in exactly one of two shapes and NEVER both:
 *
 *   - shape L (inline): `{ token, apiEndpoint (token-bearing) }`, today's contract.
 *   - shape H (hand-off): `{ apiEndpoint (token-less), handoff: { type, key } }`,
 *     no token — the credential rests in the one-time secret named by `key`.
 *
 * `handoffKey` present selects shape H. The two branches are exclusive by
 * construction, so a token can never ride alongside a hand-off.
 */
export function buildAcceptedState(opts: {
  username: string;
  /** Token-less account endpoint (what shape H publishes). */
  endpoint: string;
  /** App access token (shape L) / carried inside the secret (shape H). */
  token: string;
  /** Token-bearing endpoint (what shape L publishes). */
  apiEndpointWithToken: string;
  /** Present → shape H; absent/null → shape L. */
  handoffKey?: string | null;
  delegation?: AccessState["delegation"] | null;
}): Partial<AccessState> {
  const accepted: Partial<AccessState> = { status: "ACCEPTED", username: opts.username };
  if (opts.handoffKey != null) {
    accepted.apiEndpoint = opts.endpoint;
    accepted.handoff = { type: "shared-secret", key: opts.handoffKey };
  } else {
    accepted.apiEndpoint = opts.apiEndpointWithToken;
    accepted.token = opts.token;
  }
  if (opts.delegation != null) accepted.delegation = opts.delegation;
  return accepted;
}

/**
 * Create a one-time hand-off secret on the signed-in account (with the
 * personal token), carrying the app credential the requesting app will
 * retrieve once. Returns the secret key. Throws on any failure so the caller
 * can fall back to inline delivery.
 */
export async function createHandoffSecret(
  endpoint: string,
  personalToken: string,
  params: {
    requestingAppId: string;
    secret: { username: string; token: string; apiEndpoint: string };
    ttl?: number;
  },
): Promise<string> {
  const res = await fetch(endpoint.replace(/\/$/, "") + "/shared-secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: personalToken,
    },
    body: JSON.stringify({
      title: "access-handoff:" + params.requestingAppId,
      ttl: params.ttl ?? HANDOFF_TTL_SECONDS,
      onConsumed: { message: "The credential for this access request was already retrieved." },
      secret: params.secret,
    }),
  });
  if (!res.ok) throw new Error("create shared secret failed (" + res.status + ")");
  const body = (await res.json()) as { sharedSecret?: { key?: string } };
  if (!body.sharedSecret?.key) throw new Error("create shared secret: server returned no key");
  return body.sharedSecret.key;
}

/**
 * The poll URL is always shaped `{coreUrl}/reg/access/{key}` (open-pryv.io
 * `routes/reg/access.ts`). Derive a same-core service-info URL by replacing
 * the trailing `access/{key}` with `service/info`. Returns null on shape
 * mismatch.
 */
export function deriveServiceInfoUrlFromPollUrl(pollUrl: string): string | null {
  const m = /^(.*\/reg\/)access\/[^/]+\/?$/.exec(pollUrl);
  return m ? m[1] + "service/info" : null;
}
