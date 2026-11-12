/**
 * An access's `clientData` as rows of a definition list, for the access card
 * and the access page (instead of a JSON dump).
 *
 * - Every string goes through `maskCredentials` first: a consent grant's
 *   counterparty endpoint carries its token in the URL's user part.
 * - `app-web-auth:description` is left out: the consent message block renders it.
 * - Plain objects flatten to dotted paths, down to three segments
 *   (`oauth.client.host`). Anything deeper, an array holding objects, an empty
 *   object, or a string longer than {@link MAX_INLINE_CHARS} characters is kept
 *   whole as `{ raw }`, shown in a collapsed "Raw" view.
 * - An array of plain values is a list; `null` reads "none".
 *
 * URLs stay text: the view never makes a link of a value.
 */

import { CONSENT_KEY } from "./consentMessage";
import { maskCredentials } from "./maskCredentials";

/** Paths are flattened down to this many segments. */
export const MAX_DEPTH = 3;
/** A longer string is shown in the raw view. */
export const MAX_INLINE_CHARS = 200;

export type ClientDataValue = string | string[] | { raw: unknown } | null;

export interface ClientDataRow {
  /** Dotted path of the value (`oauth.client.host`). */
  path: string;
  value: ClientDataValue;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function valueOf(v: unknown): ClientDataValue {
  if (v === null) return null;
  if (typeof v === "string") return v.length > MAX_INLINE_CHARS ? { raw: v } : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every(isScalar)) {
    if (v.some((x) => typeof x === "string" && x.length > MAX_INLINE_CHARS)) return { raw: v };
    return v.map((x) => (x === null ? "null" : String(x)));
  }
  return { raw: v };
}

/** The rows of `data` (masked), in key order. */
export function clientDataRows(data: Record<string, unknown> | null | undefined): ClientDataRow[] {
  if (!isPlainObject(data)) return [];
  const masked = maskCredentials(data);
  const rows: ClientDataRow[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, v] of Object.entries(obj)) {
      if (depth === 1 && key === CONSENT_KEY) continue;
      if (v === undefined) continue;
      const path = prefix ? prefix + "." + key : key;
      if (isPlainObject(v) && Object.keys(v).length > 0 && depth < MAX_DEPTH) {
        walk(v, path, depth + 1);
      } else {
        rows.push({ path, value: valueOf(v) });
      }
    }
  };
  walk(masked, "", 1);
  return rows;
}
