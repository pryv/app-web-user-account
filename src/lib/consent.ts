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
 * Stream ids are compared as the core stores them: check-app answers
 * `:local:diary` as `diary` (the store root `:local:` as `*`).
 */
export function permissionKey(p: OfferPermission): string {
  if ("streamId" in p && typeof p.streamId === "string") return `s|${withoutLocalPrefix(p.streamId)}|${p.level}`;
  const f = p as { feature: string; setting: string };
  return `f|${f.feature}|${f.setting}`;
}

function withoutLocalPrefix(streamId: string): string {
  const prefix = ":local:";
  let id = streamId;
  for (let i = 0; i < 8 && id.startsWith(prefix); i++) {
    id = id.slice(prefix.length);
    if (id === "") return "*";
  }
  return id;
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
 * The level-less key of an entry (`s|<streamId>`, `f|<feature>`): it names
 * the entry whatever level or setting the screen shows it at. Stream ids are
 * read as the core stores them, like {@link permissionKey}.
 */
export function levellessKey(p: OfferPermission): string {
  if ("streamId" in p && typeof p.streamId === "string") return `s|${withoutLocalPrefix(p.streamId)}`;
  return `f|${(p as { feature: string }).feature}`;
}

/** The keys an offer may name an entry by, the exact one first. */
function entryKeys(p: OfferPermission): [string, string] {
  return [permissionKey(p), levellessKey(p)];
}

const LEVELS = new Set(["read", "contribute", "manage", "create-only", "none"]);

/**
 * An entry key as an offer wrote it, with its stream id read as the core
 * stores it, so `s|:local:diary|read` names the same entry as `s|diary|read`.
 */
function canonicalOfferKey(key: string): string {
  if (!key.startsWith("s|")) return key;
  const rest = key.slice(2);
  const bar = rest.lastIndexOf("|");
  if (bar >= 0 && LEVELS.has(rest.slice(bar + 1))) {
    return `s|${withoutLocalPrefix(rest.slice(0, bar))}|${rest.slice(bar + 1)}`;
  }
  return `s|${withoutLocalPrefix(rest)}`;
}

/**
 * The offer's own label for an entry, in the UI language: `labels` is keyed
 * by entry key, each value a localized text map. The exact key
 * ({@link permissionKey}) is looked up first, then the level-less one
 * ({@link levellessKey}).
 */
export function offerEntryLabel(
  labels: Record<string, LocalizableText> | null | undefined,
  lang: string,
): (p: OfferPermission) => string | null {
  if (labels == null) return () => null;
  const byKey = new Map<string, LocalizableText>();
  for (const [key, text] of Object.entries(labels)) {
    const canonical = canonicalOfferKey(key);
    // The key as written wins over another spelling of it.
    if (key === canonical || !Object.hasOwn(labels, canonical)) byKey.set(canonical, text);
  }
  return (p) => {
    for (const key of entryKeys(p)) {
      const text = byKey.get(key);
      if (text !== undefined) return pickText(text, lang) || null;
    }
    return null;
  };
}

/**
 * A group of consent entries the offer declares (`entryGroups`), in display
 * order. `entries` are entry keys (exact or level-less) and may name entries
 * that are not on this screen. `label` is null when the offer gave none.
 */
export interface OfferEntryGroup {
  key: string;
  label: LocalizableText | null;
  entries: string[];
}

/** One group as the consent screen renders it: indices into the flat entry list. */
export interface ConsentGroupView {
  key: string;
  /** The group's label in the UI language, or its key when it has none. */
  label: string;
  indices: number[];
}

/**
 * Where each entry of the flat list is rendered: entries no group names
 * first (offer order), then the groups (the offer's order, each with its
 * entries in offer order), then the feature restrictions no group names.
 * Indices always point into the flat list, so ticks, element ids and the
 * grant stay those of the flat list.
 */
export interface ConsentLayout {
  ungrouped: number[];
  groups: ConsentGroupView[];
  restrictions: number[];
}

/**
 * Lay out `entries` in the offer's groups. An entry joins the group naming
 * its exact key, else the group naming its level-less key; the first group
 * naming a key wins (a key in two groups is refused by the platform, this
 * keeps the screen deterministic should one get through). A group with no
 * entry on this screen is not rendered. Returns null when no group is
 * rendered at all: the screen then shows the flat list.
 */
export function consentLayout(
  entries: ConsentEntry[],
  groups: readonly OfferEntryGroup[] | null | undefined,
  lang: string,
): ConsentLayout | null {
  if (groups == null || groups.length === 0) return null;
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => {
    for (const key of g.entries) {
      const canonical = canonicalOfferKey(key);
      if (!groupOf.has(canonical)) groupOf.set(canonical, gi);
    }
  });
  const members: number[][] = groups.map(() => []);
  const ungrouped: number[] = [];
  const restrictions: number[] = [];
  entries.forEach((e, i) => {
    const [exact, levelless] = entryKeys(e.permission);
    const gi = groupOf.get(exact) ?? groupOf.get(levelless);
    if (gi != null) members[gi].push(i);
    else if (isFeatureRestriction(e.permission)) restrictions.push(i);
    else ungrouped.push(i);
  });
  const views = groups
    .map((g, gi) => ({ key: g.key, label: pickText(g.label, lang) || g.key, indices: members[gi] }))
    .filter((g) => g.indices.length > 0);
  if (views.length === 0) return null;
  return { ungrouped, groups: views, restrictions };
}

/**
 * What a group's legend states, so a collapsed group still says everything
 * the decision needs: how many entries, at which levels, how many the app
 * already holds as shown, holds at a lower level than shown, or does not hold
 * yet, and (when the user has a choice) how many are required.
 *
 * `levels`: stream entries per access level, in order of first appearance;
 * `restrictions`: feature restrictions; `otherFeatures`: other feature
 * entries. The other entries split into `alreadyAllowed` (held at the level
 * shown), `widened` (held, now asked at a higher level: `heldLevel` set) and
 * `fresh` (not held: new, or declined before; mandatory ones included), so
 * `alreadyAllowed + widened + fresh + restrictions === total`. A restriction
 * only narrows what the app can do, so it is never "new" access.
 * `required` (locked entries: mandatory ones and restrictions) overlays that
 * split; it is null without a choice, where every entry is required.
 */
export interface ConsentGroupCounts {
  total: number;
  levels: Array<{ level: string; count: number }>;
  restrictions: number;
  otherFeatures: number;
  required: number | null;
  alreadyAllowed: number;
  widened: number;
  fresh: number;
}

export function consentGroupCounts(
  entries: ConsentEntry[],
  indices: readonly number[],
  allowUserChoice: boolean,
): ConsentGroupCounts {
  const levels: Array<{ level: string; count: number }> = [];
  let restrictions = 0;
  let otherFeatures = 0;
  let required = 0;
  let alreadyAllowed = 0;
  let widened = 0;
  let fresh = 0;
  for (const i of indices) {
    const e = entries[i];
    const p = e.permission;
    const restriction = isFeatureRestriction(p);
    if ("streamId" in p && typeof p.streamId === "string") {
      const row = levels.find((l) => l.level === p.level);
      if (row) row.count += 1;
      else levels.push({ level: p.level, count: 1 });
    } else if (restriction) restrictions += 1;
    else otherFeatures += 1;
    if (e.locked) required += 1;
    if (restriction) continue;
    if (!e.currentlyGranted) fresh += 1;
    else if (e.heldLevel != null) widened += 1;
    else alreadyAllowed += 1;
  }
  return {
    total: indices.length,
    levels,
    restrictions,
    otherFeatures,
    required: allowUserChoice ? required : null,
    alreadyAllowed,
    widened,
    fresh,
  };
}

/** The tick state of a group's box: over its unlocked entries only (null when it has none). */
export function groupTickState(
  entries: ConsentEntry[],
  indices: readonly number[],
  flags: readonly boolean[],
): "checked" | "unchecked" | "mixed" | null {
  const free = indices.filter((i) => !entries[i].locked);
  if (free.length === 0) return null;
  const ticked = free.filter((i) => flags[i] ?? entries[i].initiallyTicked).length;
  if (ticked === 0) return "unchecked";
  return ticked === free.length ? "checked" : "mixed";
}

/**
 * The flags once a group's box is set to `checked`: every unlocked entry of
 * the group follows it; locked entries and entries outside the group never
 * change.
 */
export function setGroupTicks(
  entries: ConsentEntry[],
  flags: readonly boolean[],
  indices: readonly number[],
  checked: boolean,
): boolean[] {
  const inGroup = new Set(indices);
  return entries.map((e, i) =>
    inGroup.has(i) && !e.locked ? checked : (flags[i] ?? e.initiallyTicked),
  );
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
