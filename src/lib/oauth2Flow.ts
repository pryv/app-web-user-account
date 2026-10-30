/**
 * Helpers for the OAuth2 (RFC 6749) consent flow served at `/oauth2-authorize`.
 *
 * The core's `GET /oauth2/authorize` validates the client + PKCE parameters,
 * then 302-redirects the browser here with two query parameters:
 *
 *   - `state`   — the signed state: `<base64url(json-payload)>.<base64url(hmac)>`
 *   - `pryvApi` — the API endpoint (issuer) the UI calls back
 *
 * The flow has two external API touchpoints (base = `pryvApi`):
 *
 *   1. POST {pryvApi}/oauth2/authorize/accept — with the signed state, the
 *      user's authenticated session and the granted-scope subset; the server
 *      mints the access and returns the redirect URL (code + client state).
 *   2. POST {pryvApi}/oauth2/authorize/refuse — with the signed state only;
 *      returns the redirect URL carrying `error=access_denied`. No user
 *      session needed — refuse works pre-login (Cancel on the sign-in form).
 *   3. POST {pryvApi}/oauth2/authorize/offer — only when the state carries the
 *      offer by reference (`offerRef`, clients registered without an app
 *      account): returns the offer and the client's display fields. Asked
 *      again once the user signed in, with the personal session, it returns
 *      the offer joined with what the app already holds (see ComposedConsent).
 *
 * Sign-in itself goes through lib-js `Service.login` (see the route
 * component) — the service-info URL is derived from `pryvApi` below.
 */

import type { LocalizableText, OfferPermission } from "./consent";

// Permission vocabulary + display model live in `lib/consent.ts` (shared by
// every consent surface); re-exported here for the OAuth flow's callers.
export type { LocalizableText, OfferPermission } from "./consent";

/**
 * The consent offer resolved server-side at authorize time and carried
 * in the signed state: the granular permissions the app asks for plus
 * the consent texts to display. Display-only here — the server
 * re-validates the granted subset against its signed copy.
 *
 * `allowUserChoice` defaults to FALSE: the consent is ALL OR NOTHING
 * (every entry locked; the user accepts the whole set or denies). When
 * true, entries may be individually unticked — except `mandatory` ones.
 */
export interface OAuthOffer {
  offerName: string;
  permissions: OfferPermission[];
  allowUserChoice: boolean;
  title: LocalizableText | null;
  description: LocalizableText | null;
  consent: LocalizableText | null;
  /**
   * Offers by reference only (clients registered without an app account):
   * true when the app asked for a pseudonym, false when it will see the
   * username; null for state-carried offers, which never say.
   */
  randomAlias: boolean | null;
  /**
   * Display labels the server attached to the offer's entries, keyed by
   * `permissionKey` (`s|<streamId>|<level>`, `f|<feature>|<setting>`), each a
   * localized text map. Names streams that may not exist in the account yet.
   */
  entryLabels: Record<string, LocalizableText> | null;
}

/** The locale key telling the user which id the app will see, or null. */
export function identityNoticeKey(offer: OAuthOffer | null): string | null {
  if (offer == null || offer.randomAlias == null) return null;
  return offer.randomAlias ? "oauth.identityPseudonym" : "oauth.identityUsername";
}

/** Display fields decoded from the signed state payload. */
export interface OAuthState {
  clientId: string;
  redirectUri: string;
  scope: string[];
  offer: OAuthOffer | null;
  /** Set when the offer is not in the state and must be fetched (see oauth2FetchOffer). */
  offerRef: { kind: string; digest: string } | null;
  userIdHint: string | null;
  iat: number | null;
  exp: number | null;
}

/** Error thrown by accept/refuse carrying the RFC-shaped server response. */
export interface OAuthFlowError extends Error {
  oauthError?: string;
  status?: number;
  /** Stable marker some refusals carry next to `error` (e.g. `consent-out-of-date`). */
  reason?: string;
}

/**
 * Parse the signed OAuth state from the URL into the display fields the
 * consent UI needs (clientId, requested scope, etc.).
 *
 * The state is `<base64url(json-payload)>.<base64url(hmac)>`. We decode the
 * payload for DISPLAY ONLY — never trust it for security (the server
 * re-verifies the signature when we POST to /accept or /refuse). A tampered
 * state will fail at the server with an `invalid_request bad_signature` we
 * render as an error.
 *
 * Throws on malformed input — caller renders an error.
 */
export function parseOAuthState(signedState: string): OAuthState {
  if (typeof signedState !== "string" || signedState.length === 0) {
    throw new Error("parseOAuthState: state is required");
  }
  const dot = signedState.indexOf(".");
  if (dot <= 0 || dot === signedState.length - 1) {
    throw new Error("parseOAuthState: malformed state (missing signature separator)");
  }
  const body = signedState.slice(0, dot);
  const padded =
    body.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (body.length % 4)) % 4);
  let raw: string;
  try {
    raw = atob(padded);
  } catch {
    throw new Error("parseOAuthState: payload is not valid base64");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("parseOAuthState: payload is not valid JSON");
  }
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new Error("parseOAuthState: payload must be a JSON object");
  }
  const p = payload as Record<string, unknown>;
  return {
    clientId: typeof p.clientId === "string" ? p.clientId : "",
    redirectUri: typeof p.redirectUri === "string" ? p.redirectUri : "",
    scope: Array.isArray(p.scope) ? p.scope.filter((s): s is string => typeof s === "string") : [],
    offer: parseOffer(p.offer),
    offerRef: parseOfferRef(p.offerRef),
    userIdHint: typeof p.userIdHint === "string" ? p.userIdHint : null,
    iat: typeof p.iat === "number" ? p.iat : null,
    exp: typeof p.exp === "number" ? p.exp : null,
  };
}

function parseOfferRef(v: unknown): OAuthState["offerRef"] {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || typeof o.digest !== "string") return null;
  return { kind: o.kind, digest: o.digest };
}

/** Display fields of a client registered without an app account. */
export interface OAuthClientDisplay {
  clientId: string;
  name: string | null;
  logoUri: string | null;
  clientUri: string | null;
  policyUri: string | null;
  tosUri: string | null;
}

/** How an app knows the user: by a pseudonym, or by the account itself. */
export type SubjectMode = "pseudonym" | "account";

/**
 * What the core adds to the offer once the user is signed in: the offer then
 * shows what the app already holds joined with what it asks for (entries the
 * app holds carry `currentlyGranted`), and `shownDigest` names exactly that
 * screen. Posting the digest back at Accept makes the ticked set the app's
 * new access (unticking something it held takes it away).
 */
export interface ComposedConsent {
  /** Proof of the screen shown, posted back at Accept. */
  shownDigest: string;
  /** The access the app holds today, if any. */
  currentGrant: { subjectMode: SubjectMode } | null;
  /** Set when accepting switches how the app knows the user; must be acknowledged. */
  subjectChange: { from: SubjectMode; to: SubjectMode } | null;
}

/**
 * POST `{pryvApi}/oauth2/authorize/offer` with the signed state: the server
 * re-derives the offer the state points at and returns it with the client's
 * display fields. Display-only, like a state-carried offer: /accept
 * re-derives it again and checks the granted subset.
 *
 * With `username` + `userToken` (the consent's personal session), a core
 * that supports it answers the composed offer and `composed` is set; an
 * older core answers as without them and `composed` is null. `authenticated`
 * is false when the core says the token did not authenticate.
 */
export async function oauth2FetchOffer(opts: {
  pryvApi: string;
  signedState: string;
  username?: string;
  userToken?: string;
}): Promise<{
  offer: OAuthOffer;
  client: OAuthClientDisplay;
  composed: ComposedConsent | null;
  authenticated: boolean | null;
}> {
  const body: Record<string, unknown> = { state: opts.signedState };
  if (opts.username != null && opts.userToken != null) {
    body.username = opts.username;
    body.userToken = opts.userToken;
  }
  const json = await postOAuthJson(opts.pryvApi, "/oauth2/authorize/offer", body);
  const offer = parseOffer(json.offer);
  if (offer == null) throw new Error("oauth2: the server returned no consent offer");
  const c = (typeof json.client === "object" && json.client != null ? json.client : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const shownDigest = str(json.shownDigest);
  return {
    offer,
    client: {
      clientId: str(c.clientId) ?? "",
      name: str(c.clientName),
      logoUri: str(c.logoUri),
      clientUri: str(c.clientUri),
      policyUri: str(c.policyUri),
      tosUri: str(c.tosUri),
    },
    composed:
      shownDigest == null
        ? null
        : {
            shownDigest,
            currentGrant: parseCurrentGrant(json.currentGrant),
            subjectChange: parseSubjectChange(json.subjectChange),
          },
    authenticated: typeof json.authenticated === "boolean" ? json.authenticated : null,
  };
}

function asSubjectMode(v: unknown): SubjectMode | null {
  return v === "pseudonym" || v === "account" ? v : null;
}

function parseCurrentGrant(v: unknown): ComposedConsent["currentGrant"] {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const mode = asSubjectMode((v as Record<string, unknown>).subjectMode);
  return mode == null ? null : { subjectMode: mode };
}

function parseSubjectChange(v: unknown): ComposedConsent["subjectChange"] {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const from = asSubjectMode(o.from);
  const to = asSubjectMode(o.to);
  return from == null || to == null || from === to ? null : { from, to };
}

/** The locale key of the warning shown for a change of identity mode. */
export function subjectChangeKey(change: ComposedConsent["subjectChange"]): string | null {
  if (change == null) return null;
  return change.to === "account" ? "oauth.subjectChangeToAccount" : "oauth.subjectChangeToPseudonym";
}

/**
 * True when the core refused Accept because the consent screen it was given
 * no longer matches what it would show now (the app's access or the request
 * changed meanwhile): the user has to restart the authorization from the app.
 * The core says so with `reason: "consent-out-of-date"`; a core that sends no
 * `reason` is recognised by its wording.
 */
export function isStaleConsentError(err: unknown): boolean {
  const e = err as OAuthFlowError | null;
  if (e == null || e.status !== 400 || e.oauthError !== "invalid_request") return false;
  if (e.reason != null) return e.reason === "consent-out-of-date";
  return /out of date|restart the authori[sz]ation/i.test(e.message ?? "");
}

function parseOffer(v: unknown): OAuthOffer | null {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.permissions)) return null;
  const permissions = o.permissions.filter(
    (p): p is OfferPermission =>
      typeof p === "object" &&
      p != null &&
      (typeof (p as Record<string, unknown>).streamId === "string" ||
        typeof (p as Record<string, unknown>).feature === "string"),
  );
  if (permissions.length === 0) return null;
  return {
    offerName: typeof o.offerName === "string" ? o.offerName : "",
    permissions,
    allowUserChoice: o.allowUserChoice === true,
    title: asTextMap(o.title),
    description: asTextMap(o.description),
    consent: asTextMap(o.consent),
    randomAlias: typeof o.randomAlias === "boolean" ? o.randomAlias : null,
    entryLabels: asLabelMap(o.entryLabels),
  };
}

function asLabelMap(v: unknown): Record<string, LocalizableText> | null {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>)
    .map(([k, t]) => [k, asTextMap(t)] as const)
    .filter((e): e is readonly [string, LocalizableText] => e[1] != null);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function asTextMap(v: unknown): LocalizableText | null {
  if (typeof v !== "object" || v == null || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>).filter(
    ([, s]) => typeof s === "string",
  ) as [string, string][];
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Service-info URL for the platform `pryvApi` belongs to. Every core serves
 * `/reg/service/info` at its root, so this works for both single-core
 * (dnsLess) and multi-core deployments.
 */
export function serviceInfoUrlFromPryvApi(pryvApi: string): string {
  return pryvApi.replace(/\/$/, "") + "/reg/service/info";
}

/**
 * Guard against consent phishing. `pryvApi` is a query parameter that decides
 * where this page sends the user's password (on sign-in) and personal token
 * (on Accept). An attacker who lures a victim to this trusted consent origin
 * with `?pryvApi=https://attacker` would harvest both — so `pryvApi` must be
 * constrained to a trusted core before we ever call login/accept.
 *
 * Two layers, most-specific first:
 *   1. If the operator configured an allowlist (`trustedOrigins`, from the
 *      build-time env and settings.json, see trustedOrigins.ts), require an exact
 *      origin match — this is the authoritative, recommended control.
 *   2. Otherwise fall back to requiring `pryvApi` to share the consent UI's own
 *      registrable domain (`selfOrigin`): operators deploy the core and this
 *      app under one parent domain (e.g. `core.example.com` + `app.example.com`),
 *      so an off-platform `attacker.com` is rejected without any config.
 *
 * The registrable-domain fallback is a best-effort convenience and MUST NOT be
 * relied on in production. When `requireAllowlist` is set (the route passes
 * `import.meta.env.PROD`), an unset allowlist fails closed rather than falling
 * back — a production deployment with no configured allowlist is a
 * misconfiguration, not a green light.
 *
 * Always requires https (http only for loopback, for local development).
 * Throws on any violation — the caller renders it as an init error.
 */
export function assertTrustedPryvApi(
  pryvApi: string,
  opts: { trustedOrigins?: string[]; selfOrigin?: string; requireAllowlist?: boolean } = {},
): void {
  let url: URL;
  try {
    url = new URL(pryvApi);
  } catch {
    throw new Error("oauth2: `pryvApi` is not a valid URL.");
  }
  const host = url.hostname;
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("oauth2: refusing insecure `pryvApi` — https is required.");
  }

  const allow = (opts.trustedOrigins ?? []).map((o) => o.trim()).filter(Boolean);
  if (allow.length > 0) {
    if (!allow.includes(url.origin)) {
      throw new Error("oauth2: `pryvApi` origin is not in the trusted allowlist.");
    }
    return;
  }

  // No explicit allowlist configured. In production this is a misconfiguration:
  // fail closed rather than trust the weak registrable-domain fallback.
  if (opts.requireAllowlist) {
    throw new Error(
      "oauth2: no trusted API allowlist is configured — production requires an explicit allowlist.",
    );
  }

  // No explicit allowlist: a loopback core is local development — allow it.
  if (isLoopback) return;

  // Fail closed: with no allowlist AND no self-origin to compare against, there
  // is no trust anchor, so refuse rather than accept an arbitrary host.
  if (!opts.selfOrigin) {
    throw new Error("oauth2: no trusted origin configured for `pryvApi`.");
  }
  let self: URL;
  try {
    self = new URL(opts.selfOrigin);
  } catch {
    throw new Error("oauth2: cannot determine a trusted origin for `pryvApi`.");
  }
  if (registrableDomain(host) !== registrableDomain(self.hostname)) {
    throw new Error(
      "oauth2: `pryvApi` is cross-domain and no trusted allowlist is configured.",
    );
  }
}

/**
 * Best-effort registrable domain (eTLD+1 without a public-suffix list): the
 * last two dot-separated labels. Sufficient for the same-parent-domain
 * fallback; operators on multi-label public suffixes (e.g. `*.co.uk`) or
 * cross-domain deployments should configure the trusted origin list.
 */
function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  return labels.slice(-2).join(".");
}

/**
 * POST `{pryvApi}/oauth2/authorize/accept` with the signed state, the user's
 * authenticated session, and the granted permission subset (the entries the
 * user kept ticked — validated ⊆ the signed offer by the server). The server
 * establishes the durable consent (data-grant) and mints the session access,
 * then returns the redirect URL the browser should navigate to.
 *
 * `shownDigest` (from a composed offer, see {@link ComposedConsent}) says the
 * user saw what the app already holds, so the ticked set replaces it;
 * `acknowledgeSubjectChange` is the user's explicit agreement to a change of
 * identity mode. Neither is sent when unset.
 */
export async function oauth2Accept(opts: {
  pryvApi: string;
  signedState: string;
  username: string;
  personalToken: string;
  grantedPermissions: OfferPermission[];
  shownDigest?: string;
  acknowledgeSubjectChange?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    state: opts.signedState,
    username: opts.username,
    userToken: opts.personalToken,
    grantedPermissions: opts.grantedPermissions,
  };
  if (opts.shownDigest != null) body.shownDigest = opts.shownDigest;
  if (opts.acknowledgeSubjectChange === true) body.acknowledgeSubjectChange = true;
  return postOAuth(opts.pryvApi, "/oauth2/authorize/accept", body);
}

/**
 * POST `{pryvApi}/oauth2/authorize/refuse` with the signed state. The server
 * verifies the signature and returns the redirect URL with
 * `error=access_denied`. No access created, no user session needed.
 */
export async function oauth2Refuse(opts: {
  pryvApi: string;
  signedState: string;
}): Promise<string> {
  return postOAuth(opts.pryvApi, "/oauth2/authorize/refuse", { state: opts.signedState });
}

/**
 * End the personal session the consent page opened for itself
 * (POST `{endpoint}auth/logout` with its token): once the consent is answered,
 * the page has no further use for it and it should not outlive the consent.
 *
 * Best effort and bounded: it never throws and gives up after `timeoutMs`, so
 * a failure never holds back the redirect to the app (the session then simply
 * expires on its own).
 */
export async function endConsentSession(opts: {
  endpoint: string;
  token: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), opts.timeoutMs ?? 3000);
  try {
    const url = opts.endpoint.replace(/\/?$/, "/") + "auth/logout";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: opts.token },
      body: "{}",
      signal: controller?.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared POST + response handling: errors are RFC-shaped
 * `{error, error_description}` — surface `error_description || error` as the
 * message and keep `oauthError` + `status` on the thrown error.
 */
async function postOAuth(
  pryvApi: string,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  const json = await postOAuthJson(pryvApi, path, body);
  if (typeof json.redirectTo !== "string" || json.redirectTo.length === 0) {
    throw new Error("oauth2: server response missing redirectTo");
  }
  return json.redirectTo;
}

async function postOAuthJson(
  pryvApi: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof pryvApi !== "string" || pryvApi.length === 0) {
    throw new Error("oauth2: pryvApi is required");
  }
  if (typeof body.state !== "string" || body.state.length === 0) {
    throw new Error("oauth2: signedState is required");
  }
  const url = pryvApi.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    const err: OAuthFlowError = new Error(
      json.error_description || json.error || "oauth request failed: HTTP " + res.status,
    );
    err.oauthError = json.error;
    err.status = res.status;
    if (typeof json.reason === "string" && json.reason.length > 0) err.reason = json.reason;
    throw err;
  }
  return json;
}
