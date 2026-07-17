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
}

/** Fetch the access-state JSON from the registration server's poll URL. */
export async function loadAccessState(pollUrl: string): Promise<AccessState> {
  const res = await fetch(pollUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Invalid data from Access server (" + res.status + ")");
  return (await res.json()) as AccessState;
}

/**
 * Notify register of the final access state (ACCEPTED / REFUSED). Returns the
 * HTTP status. Errors are surfaced but `closeOrRedirect` runs in `finally`
 * either way per the legacy contract.
 */
export async function updateAccessState(
  pollUrl: string,
  state: Partial<AccessState>,
): Promise<number> {
  const res = await fetch(pollUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(state),
  });
  return res.status;
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
