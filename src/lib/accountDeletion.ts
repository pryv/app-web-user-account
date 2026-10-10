/**
 * Where to send the self-service account deletion (`auth.delete`).
 *
 * The platform serves it at the root of a core, `DELETE /users/{username}`,
 * not under the user's API endpoint: appending `users/{username}` to
 * `https://api.example.com/alice/` or `https://alice.example.com/` reaches
 * `/alice/users/alice` (the second through the username-in-host rewrite),
 * which does not exist.
 *
 * The root that works on both topologies is the user's home core, as the
 * register names it: `POST {register}{username}/server` answers
 * `{ server: "https://<core>/" }`, a host the rewrite leaves alone. When the
 * lookup is unavailable, the user endpoint with its trailing `{username}/`
 * segment removed is the root of a path-style platform.
 *
 * Trust: the register's answer is trusted like the service info that names
 * the register. Only the protocol is checked (no downgrade from https); a
 * host allow-list would break multi-core platforms whose cores sit on other
 * domains.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function accountDeletionUrl(opts: {
  register?: string | null;
  endpoint: string;
  username: string;
  fetchFn?: FetchLike;
}): Promise<string> {
  const { register, endpoint, username } = opts;
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const root = (register ? await homeCore(register, endpoint, username, fetchFn) : null) ?? pathStyleRoot(endpoint, username);
  return root + "users/" + encodeURIComponent(username);
}

/** The user's home core from the register, or null when it cannot tell. */
async function homeCore(register: string, endpoint: string, username: string, fetchFn: FetchLike): Promise<string | null> {
  try {
    const res = await fetchFn(withSlash(register) + encodeURIComponent(username) + "/server", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { server?: unknown };
    if (typeof body?.server !== "string") return null;
    const server = new URL(body.server);
    // The personal token goes there: never downgrade from the endpoint's https.
    const endpointProtocol = new URL(endpoint).protocol;
    if (server.protocol !== "https:" && server.protocol !== endpointProtocol) return null;
    return withSlash(server.origin + server.pathname);
  } catch {
    return null;
  }
}

/** `https://api.example.com/alice/` -> `https://api.example.com/`; other endpoints unchanged. */
function pathStyleRoot(endpoint: string, username: string): string {
  const base = withSlash(endpoint);
  const suffix = "/" + encodeURIComponent(username) + "/";
  const url = new URL(base);
  if (url.pathname.endsWith(suffix)) url.pathname = url.pathname.slice(0, -suffix.length + 1);
  return url.origin + url.pathname;
}

function withSlash(u: string): string {
  return u.endsWith("/") ? u : u + "/";
}
