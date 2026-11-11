/**
 * How an OAuth access names its app. The core stamps the consent grant
 * (`oauth-grant:<clientId>`) and each of its sessions (`oauth:<clientId>`)
 * with `clientData.oauth.client`, server-owned:
 *
 * - `{ name?, host, url, origin? }`: a client known by its metadata document
 *   (`origin: "metadata-document"` from open-pryv.io 2.0.0-rc.80). The name
 *   is the document's own claim; only the host is checked, so a screen shows
 *   the host next to the name, never the name alone.
 * - `{ name?, origin: "operator" }`: a client the operator registered; the
 *   name is the one the operator registered.
 *
 * Accesses made before a core stamped them carry none until the next
 * consent (grant) or refresh (session).
 */

export const OAUTH_GRANT_PREFIX = "oauth-grant:";
export const OAUTH_SESSION_PREFIX = "oauth:";

export type OAuthClientStamp =
  | { kind: "metadata-document"; name?: string; host: string }
  | { kind: "operator"; name?: string };

export interface OAuthAccessLike {
  id?: string;
  name?: string;
  clientData?: Record<string, unknown> | null;
}

function oauthOf(access: OAuthAccessLike | null | undefined): Record<string, unknown> | null {
  const oauth = access?.clientData?.oauth;
  return oauth != null && typeof oauth === "object" ? (oauth as Record<string, unknown>) : null;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The client stamp of an OAuth access, or null (not an OAuth access, or not stamped). */
export function oauthClientOf(access: OAuthAccessLike | null | undefined): OAuthClientStamp | null {
  const client = oauthOf(access)?.client;
  if (client == null || typeof client !== "object") return null;
  const c = client as Record<string, unknown>;
  const name = nonEmpty(c.name);
  const host = nonEmpty(c.host);
  if (host != null) return { kind: "metadata-document", host, ...(name != null ? { name } : {}) };
  if (c.origin === "operator") return { kind: "operator", ...(name != null ? { name } : {}) };
  return null;
}

/** True for an OAuth consent grant (`oauth-grant:<clientId>`). */
export function isOAuthGrant(access: OAuthAccessLike): boolean {
  return typeof access.name === "string" && access.name.startsWith(OAUTH_GRANT_PREFIX);
}

/** The client id an OAuth grant or session is named after, or null. */
export function oauthClientIdOf(access: OAuthAccessLike): string | null {
  const name = access.name;
  if (typeof name !== "string") return null;
  if (name.startsWith(OAUTH_GRANT_PREFIX)) return nonEmpty(name.slice(OAUTH_GRANT_PREFIX.length)) ?? null;
  if (name.startsWith(OAUTH_SESSION_PREFIX)) return nonEmpty(name.slice(OAUTH_SESSION_PREFIX.length)) ?? null;
  return null;
}

// An access id's base: the wire id of a grant may carry a serial (`<base>:<n>`),
// a session names its grant by the base.
function baseId(id: string): string {
  return id.split(":")[0];
}

/** The base id of the consent grant an OAuth session was minted under, or null. */
export function oauthGrantIdOf(access: OAuthAccessLike): string | null {
  const id = nonEmpty(oauthOf(access)?.dataGrantId);
  return id != null ? baseId(id) : null;
}

/** What a screen calls an access: `label`, plus the host to show next to it for a metadata-document client. */
export interface AccessNaming {
  label: string;
  host?: string;
}

/**
 * The name to show for an access: the stamp's name (with the host beside it
 * for a metadata-document client, the host alone when it has no name); for
 * an OAuth access without a stamp, its client id; any other access, its name.
 */
export function accessNaming(access: OAuthAccessLike): AccessNaming {
  const client = oauthClientOf(access);
  if (client?.kind === "metadata-document") {
    return client.name != null ? { label: client.name, host: client.host } : { label: client.host };
  }
  if (client?.kind === "operator" && client.name != null) return { label: client.name };
  const clientId = oauthClientIdOf(access);
  // A metadata-document client's row key (`url~…`) is no name: keep the access name.
  if (clientId != null && !clientId.startsWith("url~")) return { label: clientId };
  return { label: access.name ?? access.id ?? "" };
}

/**
 * The name of a folded entry: the grant's stamp, else the first stamped
 * session's (a grant made before the core stamped it, whose session a refresh
 * already stamped), else `accessNaming` of the grant.
 */
export function entryNaming(entry: { access: OAuthAccessLike; sessions: OAuthAccessLike[] }): AccessNaming {
  if (oauthClientOf(entry.access) == null) {
    const stamped = entry.sessions.find((s) => oauthClientOf(s) != null);
    if (stamped != null) return accessNaming(stamped);
  }
  return accessNaming(entry.access);
}

// An OAuth session of the grant's own client (`oauth:<clientId>`), not one
// derived for a resource server (token exchange): the accesses an app's
// session creates and a resource server's derived sessions also name the
// grant, and stay entries of their own.
function isOwnSession(access: OAuthAccessLike, grant: OAuthAccessLike): boolean {
  if (typeof access.name !== "string" || !access.name.startsWith(OAUTH_SESSION_PREFIX)) return false;
  if (oauthOf(access)?.exchange != null) return false;
  const clientId = oauthClientIdOf(access);
  return clientId != null && clientId === oauthClientIdOf(grant);
}

/**
 * Fold each OAuth session under its consent grant, when the grant is in the
 * list: one app, one entry (revoking the grant ends its sessions). A session
 * whose grant is not listed, a resource server's derived session and an
 * access an app created stay entries of their own.
 */
export function foldOAuthSessions<T extends OAuthAccessLike>(accesses: T[]): Array<{ access: T; sessions: T[] }> {
  const grants = new Map<string, { access: T; sessions: T[] }>();
  for (const a of accesses) {
    if (isOAuthGrant(a) && typeof a.id === "string") grants.set(baseId(a.id), { access: a, sessions: [] });
  }
  const out: Array<{ access: T; sessions: T[] }> = [];
  for (const a of accesses) {
    if (isOAuthGrant(a) && typeof a.id === "string") {
      out.push(grants.get(baseId(a.id))!);
      continue;
    }
    const grantId = oauthGrantIdOf(a);
    const grant = grantId != null ? grants.get(grantId) : undefined;
    if (grant != null && isOwnSession(a, grant.access)) grant.sessions.push(a);
    else out.push({ access: a, sessions: [] });
  }
  return out;
}
