/**
 * The Audit trail tab's URL contract (`/account/audit?...`). The URL is the
 * single source of truth for the filters; all are optional:
 *
 * - `access=<id>`: one access (`:<serial>` tolerated, reduced to the base id).
 * - `app=<clientId | access name>`: the accesses of one app: every access whose
 *   OAuth client id is `app` (its grant `oauth-grant:<app>` and its sessions
 *   `oauth:<app>`) plus every access named `app` (a personal session is named
 *   after the app it signed in). Wins over `access`.
 * - `from=` / `to=`: Unix seconds, or a date / date-time `Date.parse` reads; a
 *   date alone is local time, and a date-only `to` means the end of that day.
 *   An unreadable value is ignored.
 * - `kind=read | write | session | error`; other values are ignored.
 * - `action=<methodId>`: one API method.
 *
 * The hand-off parameters (`pryvServiceInfoUrl`, `backUrl`, `backLabel`,
 * `username`, `lang`) ride along untouched.
 */

import { oauthClientIdOf } from "./oauthClient";
import { parseAttribution, type AccessDetails, type TrailKind } from "./audit";

/** The query parameters the Audit trail reads. */
export const TRAIL_PARAMS = ["access", "app", "from", "to", "kind", "action"] as const;
export type TrailParam = (typeof TRAIL_PARAMS)[number];

const KINDS: readonly TrailKind[] = ["read", "write", "session", "error"];
const ACTION = /^[A-Za-z][\w.]*$/;
const SECONDS = /^\d+(\.\d+)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface TrailFilters {
  /** Base id of the access asked for. */
  access?: string;
  app?: string;
  /** Unix seconds. */
  from?: number;
  to?: number;
  kind?: TrailKind;
  action?: string;
}

/**
 * A `from` / `to` value as Unix seconds, or undefined when unreadable.
 * `endOfDay`: a date alone means the end of that local day (for `to`).
 */
export function parseTrailTime(value: string | null | undefined, endOfDay = false): number | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (v === "") return undefined;
  if (SECONDS.test(v)) return Number(v);
  const date = DATE_ONLY.exec(v);
  if (date) {
    const [y, m, d] = [Number(date[1]), Number(date[2]) - 1, Number(date[3])];
    const start = new Date(y, m, d);
    if (start.getFullYear() !== y || start.getMonth() !== m || start.getDate() !== d) return undefined;
    return endOfDay ? new Date(y, m, d + 1).getTime() / 1000 - 0.001 : start.getTime() / 1000;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : ms / 1000;
}

/** The filters a query string asks for (unreadable values dropped). */
export function parseTrailSearch(search: string): TrailFilters {
  const q = new URLSearchParams(search);
  const out: TrailFilters = {};
  const access = q.get("access")?.trim();
  if (access) out.access = parseAttribution(access).base;
  const app = q.get("app")?.trim();
  if (app) out.app = app;
  const from = parseTrailTime(q.get("from"));
  if (from !== undefined) out.from = from;
  const to = parseTrailTime(q.get("to"), true);
  if (to !== undefined) out.to = to;
  const kind = q.get("kind");
  if (kind != null && (KINDS as readonly string[]).includes(kind)) out.kind = kind as TrailKind;
  const action = q.get("action");
  if (action != null && ACTION.test(action)) out.action = action;
  return out;
}

/**
 * `search` with the given parameters set (a null or empty value removes it),
 * every other parameter kept in place; "" when nothing is left.
 */
export function searchWith(search: string, set: Partial<Record<string, string | null | undefined>>): string {
  const params = new URLSearchParams(search);
  for (const [k, v] of Object.entries(set)) {
    if (v == null || v === "") params.delete(k);
    else params.set(k, v);
  }
  const s = params.toString();
  return s ? "?" + s : "";
}

/** `search` without the Audit trail's filters: what a link out of the trail carries. */
export function withoutTrailFilters(search: string): string {
  return searchWith(search, Object.fromEntries(TRAIL_PARAMS.map((p) => [p, null])));
}

/**
 * The base ids of the accesses of an app: those whose OAuth client id is
 * `app` (the grant and its sessions, a resource server's derived sessions
 * included) and those named `app`. Empty when none matches.
 */
export function resolveAppAccessIds(accesses: AccessDetails[], app: string): string[] {
  const ids = accesses
    .filter((a) => oauthClientIdOf(a) === app || a.name === app)
    .map((a) => parseAttribution(a.id).base);
  return [...new Set(ids)];
}

/** Unix seconds as a `datetime-local` input value (local time), "" when absent. */
export function timeToInput(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
