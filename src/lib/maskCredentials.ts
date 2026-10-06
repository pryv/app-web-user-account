/**
 * Display-only masking of credentials in data the pages print as text (an
 * access's client data, audit and event contents). In Pryv an API endpoint
 * carries its token in the URL's user part (`https://<token>@<host>/<user>/`):
 * the core stores such endpoints in an access's `clientData` (the
 * counterparty's `apiEndpoint` and the back-channel endpoint of a consent
 * grant, a delegation invite's `capabilityUrl`). The owner can read them
 * through the API anyway; the page must not put them on screen, where a
 * screenshot, a screen share or a support session would carry them.
 *
 * Every string that parses as an absolute URL with a user (or password) part
 * is shown with that part replaced by `***`, the scheme, host and path kept:
 * `https://***@core.example.com/alice/`; a URL inside a longer text gets the
 * same. Anything else is left as it is.
 */

export const CREDENTIAL_MASK = "***";

// A URL's user part inside a longer text (a server message naming an
// endpoint): scheme, "//", then everything up to the "@" of the authority.
// Bounded quantifiers keep a long hostile text linear.
const EMBEDDED_USERINFO = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@"'<>]{1,512}@/gi;

/**
 * `value` with the user part of a URL masked: the whole string when it is an
 * absolute URL, else any URL inside it. A string without one is unchanged
 * (an e-mail address included).
 */
export function maskUrlCredentials(value: string): string {
  if (!value.includes("@")) return value;
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  // Not a URL with a user part as a whole (a text such as "error: could not
  // reach https://...", which may itself parse as an opaque URL): mask the URLs in it.
  if (url == null || (url.username === "" && url.password === "")) {
    return value.replace(EMBEDDED_USERINFO, "$1" + CREDENTIAL_MASK + "@");
  }
  // Rebuilt from the parsed URL rather than edited in place, so a spelling the
  // parser accepts (backslashes, odd case) cannot keep the token visible.
  return url.protocol + "//" + CREDENTIAL_MASK + "@" + url.host + url.pathname + url.search + url.hash;
}

/** A copy of `value` with `maskUrlCredentials` applied to every string, in objects and arrays at any depth. */
export function maskCredentials<T>(value: T): T {
  return maskValue(value) as T;
}

function maskValue(value: unknown): unknown {
  if (typeof value === "string") return maskUrlCredentials(value);
  if (Array.isArray(value)) return value.map(maskValue);
  if (value != null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskValue(v);
    return out;
  }
  return value;
}
