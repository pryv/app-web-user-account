/**
 * Automatic deletion of the account: the platform's contract, read and
 * written through `account.getAutoDeletion` / `account.setAutoDeletion`, and
 * the rules the account page applies before calling them.
 *
 * The platform offers it when its service info carries
 * `features.autoDeletion`; without it the page shows nothing. Times from the
 * platform are Pryv epoch seconds. A fixed date is sent as an instant with its
 * offset (the end of the picked day in the browser's time zone), never as a
 * date-only string: a bare day is a different instant in every time zone.
 */

import type { PryvConnection } from "./sessionStore";

export type AutoDeletionMode = "never" | "date" | "inactivity";
/** What a user may ask for: their own mode, or `default` (follow the platform's policy, clearing their own). */
export type AutoDeletionChoiceMode = "default" | AutoDeletionMode;

export interface AutoDeletionBounds {
  /** Shortest inactivity period a user may choose, in days. */
  minDays: number;
  /** Longest inactivity period a user may choose, in days. */
  maxDays: number;
  /** Earliest fixed date a user may choose, in days from now. */
  minLeadDays: number;
}

/** `service.info().features.autoDeletion`. */
export interface AutoDeletionFeature {
  triggers: string[];
  actions: string[];
  reminderLeadDays: number[];
  bounds: AutoDeletionBounds | null;
  userOverride: boolean;
  allowUserOptOut: boolean;
  mailAvailable: boolean;
}

export interface AutoDeletionPolicy {
  mode: AutoDeletionMode;
  /** Fixed date: an ISO instant or Pryv epoch seconds, as the platform sends it. */
  date?: string | number | null;
  inactivityDays?: number | null;
  action?: string;
}

/** `account.getAutoDeletion`. */
export interface AutoDeletionState {
  effective: AutoDeletionPolicy & { source: "user" | "operator" | "none" };
  setting: (AutoDeletionPolicy & { acknowledgedNoReminders?: boolean; updatedAt?: number }) | null;
  lastActivity: {
    personal?: number | null;
    app?: number | null;
    delegate?: number | null;
    max?: number | null;
    by?: "owner" | "delegate" | null;
  } | null;
  deadline?: number | null;
  deleteAt?: number | null;
  deadlineReason?: "date" | "inactivity" | "minimum-notice" | null;
  nextReminderAt?: number | null;
  remindersSent?: unknown;
  blocked?: { reason: string; at?: number; guard?: string } | null;
  mail?: "available" | "no-email" | "not-configured";
  bounds?: AutoDeletionBounds | null;
  userOverride?: boolean;
  allowUserOptOut?: boolean;
  actions?: string[];
}

/** One change the page asks for. */
export interface AutoDeletionChoice {
  mode: AutoDeletionChoiceMode;
  /** For `date`: the picked day, `YYYY-MM-DD`, in the browser's time zone. */
  day?: string;
  /** For `inactivity`. */
  inactivityDays?: number;
}

/** `account.setAutoDeletion` params. */
export interface AutoDeletionSetParams {
  mode: AutoDeletionChoiceMode;
  date?: string;
  inactivityDays?: number;
  action?: "delete";
  acknowledgeNoReminders?: true;
  password?: string;
}

/**
 * Platform error ids for the refusals of `account.setAutoDeletion` the page
 * explains in its own words (read from `error.data.id`, then `error.id`).
 * Any other refusal shows the platform's own message.
 */
export const AUTO_DELETION_ERRORS = {
  passwordRequired: "auto-deletion-password-required",
  wrongPassword: "auto-deletion-wrong-password",
  outOfBounds: "auto-deletion-out-of-bounds",
  optOutNotAllowed: "auto-deletion-opt-out-not-allowed",
  overrideNotAllowed: "auto-deletion-override-not-allowed",
  actionNotAllowed: "auto-deletion-action-not-allowed",
  noEmail: "auto-deletion-no-email",
  delegateRefused: "auto-deletion-delegate-refused",
} as const;

/** Message keys (under `data.autoDeletion.errors`) for the refusals above. */
const ERROR_KEYS: Record<string, string> = {
  [AUTO_DELETION_ERRORS.passwordRequired]: "passwordRequired",
  [AUTO_DELETION_ERRORS.wrongPassword]: "wrongPassword",
  [AUTO_DELETION_ERRORS.outOfBounds]: "outOfBounds",
  [AUTO_DELETION_ERRORS.optOutNotAllowed]: "optOutNotAllowed",
  [AUTO_DELETION_ERRORS.overrideNotAllowed]: "overrideNotAllowed",
  [AUTO_DELETION_ERRORS.actionNotAllowed]: "actionNotAllowed",
  [AUTO_DELETION_ERRORS.noEmail]: "noEmail",
  [AUTO_DELETION_ERRORS.delegateRefused]: "delegateRefused",
};

/** A refusal from the platform, with its most specific id. */
export class AutoDeletionError extends Error {
  readonly ids: string[];
  constructor(message: string, ids: string[]) {
    super(message);
    this.name = "AutoDeletionError";
    this.ids = ids;
  }
  has(id: string): boolean {
    return this.ids.includes(id);
  }
}

/**
 * The message key (under `data.autoDeletion.errors`) for a refusal, or null
 * when the page has no words of its own for it and shows the platform's
 * message. The password check reuses the platform's generic refusal, so its
 * wording is recognised too.
 */
export function autoDeletionErrorKey(err: unknown): string | null {
  if (!(err instanceof AutoDeletionError)) return null;
  for (const id of err.ids) {
    if (ERROR_KEYS[id]) return ERROR_KEYS[id];
  }
  if (/password does not match/i.test(err.message)) return "wrongPassword";
  return null;
}

/** `features.autoDeletion` out of a service info, or null when the platform does not offer it. */
export function readAutoDeletionFeature(info: unknown): AutoDeletionFeature | null {
  const raw = field(field(info, "features"), "autoDeletion");
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    triggers: strings(r.triggers),
    actions: strings(r.actions),
    reminderLeadDays: Array.isArray(r.reminderLeadDays)
      ? r.reminderLeadDays.filter((n): n is number => typeof n === "number" && n > 0)
      : [],
    bounds: readBounds(r.bounds),
    userOverride: r.userOverride !== false,
    allowUserOptOut: r.allowUserOptOut !== false,
    mailAvailable: r.mailAvailable !== false,
  };
}

function readBounds(raw: unknown): AutoDeletionBounds | null {
  const minDays = field(raw, "minDays");
  const maxDays = field(raw, "maxDays");
  const minLeadDays = field(raw, "minLeadDays");
  if (typeof minDays !== "number" || typeof maxDays !== "number") return null;
  return { minDays, maxDays, minLeadDays: typeof minLeadDays === "number" ? minLeadDays : 0 };
}

/** One batch call; throws an `AutoDeletionError` on a refusal. */
async function call<T>(conn: PryvConnection, method: string, params: unknown): Promise<T> {
  const [res] = (await conn.api([{ method, params }])) as Array<
    (T & { error?: undefined }) | { error: { id?: string; message?: string; data?: { id?: string } } }
  >;
  if (res == null) throw new AutoDeletionError("", []);
  if (res.error) {
    const ids = [res.error.data?.id, res.error.id].filter((s): s is string => typeof s === "string" && s !== "");
    throw new AutoDeletionError(res.error.message ?? "", ids);
  }
  return res as T;
}

export async function getAutoDeletion(conn: PryvConnection): Promise<AutoDeletionState> {
  const res = await call<{ autoDeletion?: AutoDeletionState } & Partial<AutoDeletionState>>(
    conn,
    "account.getAutoDeletion",
    {},
  );
  // The state, whether the platform wraps it in `autoDeletion` or not.
  return (res.autoDeletion ?? res) as AutoDeletionState;
}

export async function setAutoDeletion(conn: PryvConnection, params: AutoDeletionSetParams): Promise<void> {
  await call(conn, "account.setAutoDeletion", params);
}

/** The `setAutoDeletion` params for a choice (without password or acknowledgement). */
export function paramsFor(choice: AutoDeletionChoice): AutoDeletionSetParams {
  if (choice.mode === "date") {
    if (!choice.day) throw new Error("a date is required");
    return { mode: "date", date: endOfLocalDayIso(choice.day), action: "delete" };
  }
  if (choice.mode === "inactivity") {
    if (choice.inactivityDays == null) throw new Error("a period is required");
    return { mode: "inactivity", inactivityDays: choice.inactivityDays, action: "delete" };
  }
  return { mode: choice.mode };
}

/**
 * Whether the platform asks the account password for this change: it arms a
 * schedule (from no own setting or "never"), switches to another trigger,
 * shortens the period, brings the date nearer, or turns a transfer into a
 * deletion. Clearing (`default`, `never`) and lengthening do not need it. The
 * platform decides in the end: a "password required" refusal is answered by
 * asking it then.
 */
export function requiresPassword(setting: AutoDeletionState["setting"], choice: AutoDeletionChoice): boolean {
  if (choice.mode === "default" || choice.mode === "never") return false;
  if (setting == null || setting.mode === "never") return true;
  if (setting.mode !== choice.mode) return true;
  if (setting.action != null && setting.action !== "delete") return true;
  if (choice.mode === "inactivity") {
    const current = setting.inactivityDays;
    return current == null || (choice.inactivityDays ?? 0) < current;
  }
  const current = toSeconds(setting.date);
  if (current == null || !choice.day) return true;
  return Date.parse(endOfLocalDayIso(choice.day)) / 1000 < current;
}

/** A platform date (ISO string or epoch seconds) as epoch seconds, or null. */
export function toSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms / 1000;
  }
  return null;
}

/**
 * The last second of `day` (`YYYY-MM-DD`) in the browser's time zone, as an
 * ISO-8601 instant with that zone's offset on that day, e.g.
 * `2027-06-01T23:59:59+02:00`.
 */
export function endOfLocalDayIso(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error("expected YYYY-MM-DD");
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 0);
  return isoWithOffset(date);
}

/** A local date-time as ISO-8601 with the local offset of that instant. */
export function isoWithOffset(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    localDay(date) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds()) +
    sign +
    pad(Math.floor(abs / 60)) +
    ":" +
    pad(abs % 60)
  );
}

/** `YYYY-MM-DD` of a date in the browser's time zone (the value of a date input). */
export function localDay(date: Date): string {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

/** The earliest day a fixed date may be picked: today plus `minLeadDays`, local. */
export function earliestDay(now: Date, minLeadDays: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.max(0, minLeadDays));
  return localDay(d);
}

/** `YYYY-MM-DD` of a platform date, in the browser's time zone, or "". */
export function dayOf(value: string | number | null | undefined): string {
  const s = toSeconds(value);
  return s == null ? "" : localDay(new Date(s * 1000));
}

/** Inactivity periods offered as presets: 1, 2, 5 and 10 years, those within the bounds. */
export const INACTIVITY_PRESET_YEARS = [1, 2, 5, 10];

export function inactivityPresets(bounds: AutoDeletionBounds | null): Array<{ years: number; days: number }> {
  return INACTIVITY_PRESET_YEARS.map((years) => ({ years, days: years * 365 })).filter(
    (p) => bounds == null || (p.days >= bounds.minDays && p.days <= bounds.maxDays),
  );
}

/**
 * The reminder leads that apply to a schedule: those shorter than the
 * inactivity period, or than the time left before a fixed date.
 */
export function remindersFor(leadDays: number[], choice: AutoDeletionChoice, now: Date): number[] {
  let horizon = Infinity;
  if (choice.mode === "inactivity" && choice.inactivityDays != null) horizon = choice.inactivityDays;
  if (choice.mode === "date" && choice.day) {
    horizon = (Date.parse(endOfLocalDayIso(choice.day)) - now.getTime()) / 86_400_000;
  }
  return [...leadDays].sort((a, b) => b - a).filter((d) => d < horizon);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

function field(value: unknown, key: string): unknown {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
