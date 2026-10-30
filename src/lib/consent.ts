/**
 * Shared consent display model — the ONE vocabulary every consent surface
 * renders permissions with (`/oauth2-authorize`, legacy `/auth`,
 * `/cmc-accept`, `/cmc-scope-update`).
 *
 * Pure module: types + mappers only. The matching UI pieces live in
 * `src/components/consent/` (PermissionList, ConsentActions, ConsentSignIn);
 * each flow container maps its own wire shape (signed-state offer, CMC
 * capability offer, legacy checkedPermissions, scope-update proposal) into
 * `ConsentEntry[]` and hands it to the shared components.
 */

import i18n from "../i18n";
import type { StreamLabelResolver } from "./streamLabels";

/** Localized text map: language code → string (e.g. `{ en: "…" }`). */
export type LocalizableText = Record<string, string>;

/**
 * One entry of the granular permission set — the full Pryv
 * `accesses.create` lexicon: a stream permission (`streamId` + `level`,
 * optional display names) or a feature permission (e.g.
 * `{ feature: "selfRevoke", setting: "forbidden" }`).
 *
 * Consent-layer annotations may ride along, and together they say how the
 * row should open:
 *   `mandatory: true`: required; the user cannot untick it.
 *   neither         : optional, ticked to begin with (the user opts out).
 *   `optIn: true`   : optional, UNticked to begin with (the user opts in).
 *   `currentlyGranted: true`: the app already holds this entry (a consent
 *                     shown again to an app the user already allowed); it
 *                     opens ticked, and unticking it takes it away.
 *   `currentLevel`  : on a held stream entry, the level the app holds today
 *                     (`level` is then what it will hold: today's level joined
 *                     with what it asks for).
 * All are display-layer only: they never travel on a grant, and the
 * server strips them before minting an access.
 */
export type OfferPermission = (
  | { streamId: string; level: string; defaultName?: string; name?: string }
  | { feature: string; setting: string }
) & { mandatory?: boolean; optIn?: boolean; currentlyGranted?: boolean; currentLevel?: string };

/**
 * Display model for one consent-screen row.
 *
 * `locked` — the user cannot untick this entry (all-or-nothing consent, or
 * a `mandatory` entry within a choice-enabled one).
 * `showRequiredHint` — render the "(required by this app)" hint: only
 * meaningful when the rest of the list IS untickable, i.e. on `mandatory`
 * entries of a choice-enabled request.
 * `initiallyTicked`: the state the row opens in. Locked rows are always
 * ticked; an `optIn` row opens unticked so the user has to choose it, unless
 * the app already holds it.
 * `currentlyGranted`: the app already holds this entry (never set on a
 * feature restriction, which reads as one on its own).
 * `heldLevel`: on a held stream entry whose level changes, the level the app
 * holds today (null when it already holds the level shown, or holds nothing).
 */
export interface ConsentEntry {
  permission: OfferPermission;
  label: string;
  locked: boolean;
  showRequiredHint: boolean;
  initiallyTicked: boolean;
  currentlyGranted: boolean;
  heldLevel: string | null;
}

/**
 * A feature restriction (`setting: "forbidden"`): it only ever narrows what
 * the app can do, so it is never the user's to untick (that would hand the
 * app more than it asked for).
 */
export function isFeatureRestriction(p: OfferPermission): boolean {
  return "feature" in p && p.setting === "forbidden";
}

/**
 * Map a permission set to consent-screen entries.
 *
 * `allowUserChoice` defaults to FALSE — consent is ALL OR NOTHING (every
 * entry locked; the user accepts the whole set or denies). When true,
 * entries may be individually unticked, EXCEPT those flagged
 * `mandatory: true`, which stay locked and get the required hint.
 *
 * `optIn` only means anything once the user HAS a choice: with an
 * all-or-nothing consent every row is locked and ticked, so opening one
 * unticked would show a state the user cannot act on and the server would
 * refuse. An entry the app already holds (`currentlyGranted`) always opens
 * ticked: what the app has is shown as it is, and unticking takes it away.
 * Feature restrictions are always locked, whatever `mandatory` and `optIn`
 * say (see {@link isFeatureRestriction}); they never get the required hint.
 *
 * Names, see {@link permissionLabel}: `entryLabel` (labels the offer carries
 * for its own entries), `labelFor` (a deployment's stream-label resolver, see
 * `streamLabels.ts`) and `accountName` (the account's own stream names); a
 * `null` answer from any of them falls through to the next source.
 */
export function consentEntries(
  permissions: OfferPermission[],
  opts: { allowUserChoice?: boolean } & LabelSources = {},
): ConsentEntry[] {
  const allowUserChoice = opts.allowUserChoice === true;
  return permissions.map((p) => {
    const restriction = isFeatureRestriction(p);
    const locked = !allowUserChoice || p.mandatory === true || restriction;
    // A restriction the app is already under is not something "allowed": the
    // row's own wording ("The app cannot …") says it all.
    const currentlyGranted = p.currentlyGranted === true && !restriction;
    const heldLevel =
      currentlyGranted &&
      "streamId" in p &&
      typeof p.currentLevel === "string" &&
      p.currentLevel !== "" &&
      p.currentLevel !== p.level
        ? p.currentLevel
        : null;
    return {
      permission: p,
      label: permissionLabel(p, opts),
      locked,
      showRequiredHint: allowUserChoice && p.mandatory === true && !restriction,
      initiallyTicked: locked || currentlyGranted || p.optIn !== true,
      currentlyGranted,
      heldLevel,
    };
  });
}

/**
 * Stream permissions read back from a stored access carry no display names
 * (the core keeps only what an access grants). Give each the `defaultName`
 * the current request sent for the same stream, so an access the app already
 * holds reads like the access it would get. Display only: what each entry
 * grants is unchanged, and a name the entry already has is kept.
 */
export function withRequestedNames(
  permissions: readonly OfferPermission[],
  requested: readonly unknown[] | null | undefined,
): OfferPermission[] {
  const names = new Map<string, string>();
  for (const r of requested ?? []) {
    if (r == null || typeof r !== "object") continue;
    const { streamId, defaultName, name } = r as { streamId?: unknown; defaultName?: unknown; name?: unknown };
    if (typeof streamId !== "string" || names.has(streamId)) continue;
    const label = typeof defaultName === "string" && defaultName !== "" ? defaultName : name;
    if (typeof label === "string" && label !== "") names.set(streamId, label);
  }
  return permissions.map((p) => {
    if (!("streamId" in p) || typeof p.streamId !== "string") return p;
    if (p.name != null || p.defaultName != null) return p;
    const label = names.get(p.streamId);
    return label == null ? p : { ...p, defaultName: label };
  });
}

/** The tick state a consent list opens in, positionally matching `entries`. */
export function initialFlags(entries: ConsentEntry[]): boolean[] {
  return entries.map((e) => e.initiallyTicked);
}

/**
 * Identity of a permission entry, matching the server's rule exactly:
 * what it grants, not what it is called. Display names are deliberately
 * excluded so an entry from the consent form matches its twin from
 * check-app, which resolved the names against the account's real streams.
 */
export function permissionKey(p: OfferPermission): string {
  if ("streamId" in p && typeof p.streamId === "string") return `s|${p.streamId}|${p.level}`;
  const f = p as { feature: string; setting: string };
  return `f|${f.feature}|${f.setting}`;
}

/**
 * The permission subset a consent grant carries, given the user's ticks:
 * locked entries are always granted, unlocked ones follow their flag —
 * with the consent-layer annotations stripped. They never travel on a
 * grant, and `accesses.create` rejects unknown per-entry fields outright,
 * so leaving one on would fail the mint rather than be ignored.
 */
export function grantedPermissions(
  entries: ConsentEntry[],
  flags: boolean[],
): OfferPermission[] {
  return entries
    .filter((e, i) => e.locked || flags[i])
    .map(({ permission: { mandatory: _m, optIn: _o, currentlyGranted: _c, currentLevel: _l, ...p } }) => p as OfferPermission);
}

/** Catalog key of each access level's verb (what the row lets the app do). */
const LEVEL_LABEL_KEYS: Record<string, string> = {
  read: "consent.permLevelRead",
  contribute: "consent.permLevelContribute",
  manage: "consent.permLevelManage",
  "create-only": "consent.permLevelCreateOnly",
  none: "consent.permLevelNone",
};

/** This app's verb for an access level (the level itself when unknown). */
export function levelLabel(level: string): string {
  return Object.hasOwn(LEVEL_LABEL_KEYS, level) ? i18n.t(LEVEL_LABEL_KEYS[level]) : level;
}

/** Where a consent row's name can come from, most specific first. */
export interface LabelSources {
  /** A label the offer itself carries for this entry. */
  entryLabel?: (p: OfferPermission) => string | null;
  /** The deployment's stream labels. */
  labelFor?: StreamLabelResolver;
  /** The name of the stream in the account, when it exists there. */
  accountName?: StreamLabelResolver;
}

/** Catalog key of the dedicated wording of each known feature restriction. */
const FEATURE_LABEL_KEYS: Record<string, string> = {
  "selfRevoke|forbidden": "consent.featureSelfRevokeForbidden",
  "webhooks|forbidden": "consent.featureWebhooksForbidden",
  "secretSharing|forbidden": "consent.featureSecretSharingForbidden",
};

/**
 * Human label for one granular permission entry. Stream permissions
 * render as "<level verb> “<stream name>”", the stream named by the first
 * source that knows it: the offer's own label for the entry, the deployment's
 * stream labels, the account's stream name, the request's `name` /
 * `defaultName`, and last the stream id. The level verb always comes from this
 * app, never from a label. Known feature permissions get a dedicated wording;
 * unknown ones use the offer's label, else "The app cannot use …" for a
 * restriction and `feature: setting` otherwise.
 */
export function permissionLabel(p: OfferPermission, sources: LabelSources = {}): string {
  const entryLabel = safeLabel(() => sources.entryLabel?.(p));
  if ("streamId" in p && typeof p.streamId === "string") {
    const level = levelLabel(p.level);
    if (p.streamId === "*") return i18n.t("consent.permissionOnAllData", { level });
    const streamId = p.streamId;
    const name =
      entryLabel ??
      safeLabel(() => sources.labelFor?.(streamId)) ??
      safeLabel(() => sources.accountName?.(streamId)) ??
      p.name ??
      p.defaultName ??
      streamId;
    return i18n.t("consent.permissionOnStream", { level, name });
  }
  const f = p as { feature: string; setting: string };
  const key = `${f.feature}|${f.setting}`;
  if (Object.hasOwn(FEATURE_LABEL_KEYS, key)) return i18n.t(FEATURE_LABEL_KEYS[key]);
  if (entryLabel != null) return entryLabel;
  if (f.setting === "forbidden") return i18n.t("consent.featureForbidden", { feature: f.feature });
  return `${f.feature}: ${f.setting}`;
}

/** A source's label, or null when it has none (or fails: display only, never fatal). */
function safeLabel(get: () => string | null | undefined): string | null {
  try {
    const label = get();
    return typeof label === "string" && label !== "" ? label : null;
  } catch {
    return null;
  }
}

/**
 * The offer's own label for an entry, in the UI language: `labels` is keyed
 * by {@link permissionKey}, each value a localized text map.
 */
export function offerEntryLabel(
  labels: Record<string, LocalizableText> | null | undefined,
  lang: string,
): (p: OfferPermission) => string | null {
  return (p) => {
    if (labels == null) return null;
    const key = permissionKey(p);
    if (!Object.hasOwn(labels, key)) return null;
    return pickText(labels[key], lang) || null;
  };
}

/**
 * Pick the best language variant from a localized text map: `lang` itself,
 * then its base language (`fr-CH` -> `fr`), then `en`, then the first entry.
 */
export function pickText(t: LocalizableText | null | undefined, lang = "en"): string {
  if (t == null) return "";
  if (typeof t[lang] === "string") return t[lang];
  const base = lang.split("-")[0];
  if (typeof t[base] === "string") return t[base];
  if (typeof t.en === "string") return t.en;
  const first = Object.values(t)[0];
  return typeof first === "string" ? first : "";
}
