import { getDefaultServiceInfoUrl } from "./deployedSettings";
import { STORE_KEY_SERVICE } from "./sessionStore";

/**
 * Build the `/signin` path with `pryvServiceInfoUrl` preserved.
 *
 * Prefers the URL passed in (typically `useLocation().search`), so a
 * just-opened `/account/...` deep-link keeps its service-info on the
 * round-trip to /signin. Falls back to the last persisted session's
 * service-info URL so a clean sign-out → sign-in lands the user on the
 * right Pryv instance without needing the calling app to re-include the
 * param. Last, the deployment's default platform from settings.json.
 */
export function signinPath(searchOrUndefined?: string, returnTo?: string | null): string {
  let serviceInfoUrl: string | null = null;
  const sp = new URLSearchParams(searchOrUndefined ?? "");
  serviceInfoUrl = sp.get("pryvServiceInfoUrl");
  if (!serviceInfoUrl) {
    try {
      serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE);
    } catch {
      serviceInfoUrl = null;
    }
  }
  serviceInfoUrl ??= getDefaultServiceInfoUrl();
  const out = new URLSearchParams();
  if (serviceInfoUrl) out.set("pryvServiceInfoUrl", serviceInfoUrl);
  carryHandoffParams(sp, out);
  // A fresh target wins; otherwise keep the one already on a re-bounce.
  const target = safeReturnTo(returnTo) ?? safeReturnTo(sp.get("returnTo"));
  if (target) out.set("returnTo", target);
  const query = out.toString();
  return query ? "/signin?" + query : "/signin";
}

/**
 * Query params an embedding app sets on any entry link, kept across the
 * sign-in bounce: a sign-in pre-fill and the "go back" affordance.
 */
export const HANDOFF_PARAMS = ["username", "backUrl", "backLabel"] as const;

function carryHandoffParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const key of HANDOFF_PARAMS) {
    const value = from.get(key);
    if (value) to.set(key, value);
  }
}

/** The pages a signed-out visitor is bounced from and may be returned to. */
const RETURN_TO_PREFIXES = ["/account/", "/change-password"] as const;

/**
 * `raw` as a same-origin path to return to after sign-in, or null.
 *
 * Query-supplied, so it is validated like a redirect target: root-relative
 * only (no scheme, no `//` or `/\` authority), and limited to the account
 * pages whose guards set it. Those pages carry nothing secret in their query,
 * which is what lets `returnTo` ride through a third-party sign-in; approval
 * hand-offs, whose query holds a bearer link, keep using `next` instead.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://origin.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://origin.invalid") return null;
  const path = url.pathname;
  const allowed = RETURN_TO_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
  if (!allowed) return null;
  // Never nested: a returnTo inside the target could resurrect a stale page.
  url.searchParams.delete("returnTo");
  return path + url.search + url.hash;
}

/** `path` with `pryvServiceInfoUrl` and the hand-off params carried over. */
export function accountPath(path: string, search: string | undefined, serviceInfoUrl: string | null): string {
  const from = new URLSearchParams(search ?? "");
  const out = new URLSearchParams();
  if (serviceInfoUrl) out.set("pryvServiceInfoUrl", serviceInfoUrl);
  carryHandoffParams(from, out);
  const query = out.toString();
  return query ? path + "?" + query : path;
}

