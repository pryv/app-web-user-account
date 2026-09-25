/**
 * Which allowed platform an access request's poll URL belongs to, for a
 * deployment restricted by `allowedServiceInfoUrls`.
 *
 * The consent page loads the request from the poll URL and posts the granted
 * token back to it, so the poll URL must be served by a platform the operator
 * chose. Its path says nothing reliable about that: open-pryv.io serves it from
 * the core that took the request (`https://core-a.example.com/reg/access/<key>`)
 * or from the register (`https://reg.example.com/access/<key>`). The only trust
 * anchor is the service info of an allowed platform, fetched from the URL the
 * operator configured: the poll URL is accepted when its origin is one that
 * service info declares. Nothing served by the poll host itself is consulted.
 */

import { BOOT_FETCH_TIMEOUT_MS, getAllowedPlatforms, sameUrl } from "./deployedSettings";
import { trustedApiOrigins } from "./trustedOrigins";

/** The service-info fields that name a platform's origins. */
export interface PlatformServiceInfo {
  register?: string;
  access?: string;
  api?: string;
  support?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Access-request keys are base64url; nothing else may follow `access/`.
const POLL_PATH = /^(\/reg)?\/access\/[A-Za-z0-9_-]+\/?$/;
const USERNAME = "{username}";
const PLACEHOLDER = "username-placeholder";

function httpsOrLoopback(u: URL): boolean {
  return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname));
}

function parse(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Whether `pollUrl` is an access-request URL served from an origin the
 * platform's service info declares, or from one of `extraOrigins` (the
 * operator's `trustedApiOrigins`).
 */
export function pollUrlOnPlatform(
  pollUrl: string,
  info: PlatformServiceInfo,
  extraOrigins: string[] = [],
): boolean {
  const poll = parse(pollUrl);
  if (!poll || !httpsOrLoopback(poll)) return false;
  if (poll.username || poll.password || poll.search || poll.hash) return false;
  if (!POLL_PATH.test(poll.pathname)) return false;

  const origins = new Set(extraOrigins);
  for (const field of [info.register, info.access]) {
    const u = parse(field);
    if (u && httpsOrLoopback(u)) origins.add(u.origin);
  }
  if (origins.has(poll.origin)) return true;

  if (typeof info.api !== "string") return false;
  const api = parse(info.api.split(USERNAME).join(PLACEHOLDER));
  if (!api || !httpsOrLoopback(api)) return false;
  if (!api.hostname.includes(PLACEHOLDER)) {
    // Path-style api (`https://core.example.com/{username}/`): one exact origin.
    return api.origin === poll.origin;
  }
  // `https://{username}.example.com/`: the platform owns every host one label
  // under example.com, its cores included. Only when the template starts with
  // the username label, and never a bare top-level domain. The apex itself is
  // not included: it is usually the operator's website, not an API host.
  if (!api.hostname.startsWith(PLACEHOLDER + ".")) return false;
  const domain = api.hostname.slice(PLACEHOLDER.length + 1);
  if (domain.split(".").length < 2) return false;
  if (poll.protocol !== api.protocol || poll.port !== api.port) return false;
  const label = poll.hostname.endsWith("." + domain)
    ? poll.hostname.slice(0, -(domain.length + 1))
    : null;
  return label != null && label.length > 0 && !label.includes(".");
}

const infoCache = new Map<string, PlatformServiceInfo>();

/**
 * The service info at an operator-configured URL, or null when it cannot be
 * read in time. Successes are memoised per page load; failures are not.
 */
export async function fetchPlatformInfo(
  serviceInfoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformServiceInfo | null> {
  const cached = infoCache.get(serviceInfoUrl);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOOT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(serviceInfoUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const info = body as PlatformServiceInfo;
    infoCache.set(serviceInfoUrl, info);
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For a restricted deployment: the allowed platform the poll URL belongs to,
 * with its (trusted) service info, or null when it belongs to none, or when
 * the deployment is not restricted. When the link names a platform
 * (`serviceInfoUrl`), only that one is considered, and it must be allowed.
 * The returned URL is the configured spelling, so sessions are keyed on one
 * form of it. A poll URL admitted only through `trustedApiOrigins` is
 * attributed to the first allowed platform whose service info loads: on a
 * deployment serving several platforms, such links must name their platform.
 */
export async function resolvePollPlatform(
  pollUrl: string,
  serviceInfoUrl: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ serviceInfoUrl: string; serviceInfo: PlatformServiceInfo } | null> {
  const allowed = getAllowedPlatforms();
  if (!allowed) return null;
  let candidates: string[];
  if (serviceInfoUrl != null) {
    const configured = allowed.find((c) => sameUrl(c, serviceInfoUrl));
    if (configured == null) return null;
    candidates = [configured];
  } else {
    candidates = allowed;
  }
  const extra = trustedApiOrigins();
  for (const candidate of candidates) {
    const info = await fetchPlatformInfo(candidate, fetchImpl);
    if (info && pollUrlOnPlatform(pollUrl, info, extra)) {
      return { serviceInfoUrl: candidate, serviceInfo: info };
    }
  }
  return null;
}

/** Test hook: forget memoised service info. */
export function _clearPlatformInfoCacheForTest(): void {
  infoCache.clear();
}
