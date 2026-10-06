/**
 * Display-only masking of credentials in data the pages print as text (an
 * access's client data, audit and event contents, error messages). In Pryv an
 * API endpoint carries its token in the URL's user part
 * (`https://<token>@<host>/<user>/`): the core stores such endpoints in an
 * access's `clientData` (the counterparty's `apiEndpoint` and the back-channel
 * endpoint of a consent grant, a delegation invite's `capabilityUrl`). The
 * owner can read them through the API anyway; the page must not put them on
 * screen, where a screenshot, a screen share or a support session would carry
 * them.
 *
 * The user (and password) part of every URL in a string is shown as `***`,
 * the scheme, host and path kept: `https://***@core.example.com/alice/`. That
 * holds for a string that is a URL, for URLs inside a longer text, in a query
 * or a fragment, and for a URL percent-encoded in a query
 * (`https%3A%2F%2F***%40core.example.com...`). Anything else is left as it is.
 *
 * For logs, `redactUrls` in `src/lib/apiError.ts` replaces whole URLs instead
 * (nothing of the endpoint is needed there). The two contracts differ on
 * purpose: keep both.
 */

export const CREDENTIAL_MASK = "***";

// A URL's user part: scheme, "//", then everything up to the "@" of the
// authority. Bounded quantifiers keep a long hostile text linear (a user part
// longer than 512 characters inside a text is not recognised).
const EMBEDDED_USERINFO = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@"'<>]{1,512}@/gi;
// The same, percent-encoded in a query value (`capabilityUrl=https%3A%2F%2F<token>%40<host>`).
const ENCODED_USERINFO = /([a-z][a-z0-9+.-]{0,31}%3a%2f%2f)(?:(?!%40|%2f|%3f|%23)[^\s&"'<>]){1,512}%40/gi;

/**
 * `value` with the user part of every URL in it masked. A string that is a
 * URL with a user part (no whitespace) is rebuilt from the parsed URL, so a
 * spelling the parser accepts (backslashes, odd case) cannot keep the token
 * visible; it is then shown normalised (a trailing "/" added, an
 * internationalised host in its ASCII form). Then every URL inside the result
 * (a second one, a query, a fragment) is masked too. A string without a URL
 * user part is unchanged (an e-mail address included).
 */
export function maskUrlCredentials(value: string): string {
  if (!value.includes("@") && !/%40/i.test(value)) return value;
  let out = value;
  // With whitespace it is a text, not one URL (the parser would percent-encode it).
  if (!/\s/.test(value)) {
    try {
      const url = new URL(value);
      if (url.username !== "" || url.password !== "") {
        out = url.protocol + "//" + CREDENTIAL_MASK + "@" + url.host + url.pathname + url.search + url.hash;
      }
    } catch {
      // Not a URL as a whole: only the URLs inside it.
    }
  }
  return out
    .replace(EMBEDDED_USERINFO, "$1" + CREDENTIAL_MASK + "@")
    .replace(ENCODED_USERINFO, "$1" + CREDENTIAL_MASK + "%40");
}

/**
 * A copy of `value` with `maskUrlCredentials` applied to every string, in
 * plain objects and arrays at any depth (what the API returns as JSON). Other
 * objects (class instances, `Map`, `Date`) are returned as they are.
 */
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
