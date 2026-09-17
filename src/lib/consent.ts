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

/** Localized text map: language code → string (e.g. `{ en: "…" }`). */
export type LocalizableText = Record<string, string>;

/**
 * One entry of the granular permission set — the full Pryv
 * `accesses.create` lexicon: a stream permission (`streamId` + `level`,
 * optional display names) or a feature permission (e.g.
 * `{ feature: "selfRevoke", setting: "forbidden" }`).
 *
 * Two consent-layer annotations may ride along, and together they say how
 * the row should open:
 *   `mandatory: true`: required; the user cannot untick it.
 *   neither         : optional, ticked to begin with (the user opts out).
 *   `optIn: true`   : optional, UNticked to begin with (the user opts in).
 * Both are display-layer only: they never travel on a grant, and the
 * server strips them before minting an access.
 */
export type OfferPermission = (
  | { streamId: string; level: string; defaultName?: string; name?: string }
  | { feature: string; setting: string }
) & { mandatory?: boolean; optIn?: boolean };

/**
 * Display model for one consent-screen row.
 *
 * `locked` — the user cannot untick this entry (all-or-nothing consent, or
 * a `mandatory` entry within a choice-enabled one).
 * `showRequiredHint` — render the "(required by this app)" hint: only
 * meaningful when the rest of the list IS untickable, i.e. on `mandatory`
 * entries of a choice-enabled request.
 * `initiallyTicked`: the state the row opens in. Locked rows are always
 * ticked; an `optIn` row opens unticked so the user has to choose it.
 */
export interface ConsentEntry {
  permission: OfferPermission;
  label: string;
  locked: boolean;
  showRequiredHint: boolean;
  initiallyTicked: boolean;
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
 * refuse.
 */
export function consentEntries(
  permissions: OfferPermission[],
  opts: { allowUserChoice?: boolean } = {},
): ConsentEntry[] {
  const allowUserChoice = opts.allowUserChoice === true;
  return permissions.map((p) => {
    const locked = !allowUserChoice || p.mandatory === true;
    return {
      permission: p,
      label: permissionLabel(p),
      locked,
      showRequiredHint: allowUserChoice && p.mandatory === true,
      initiallyTicked: locked || p.optIn !== true,
    };
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
    .map(({ permission: { mandatory: _m, optIn: _o, ...p } }) => p as OfferPermission);
}

const LEVEL_LABELS: Record<string, string> = {
  read: "Read",
  contribute: "Add and modify",
  manage: "Fully manage",
  "create-only": "Add (write-only)",
  none: "No access to",
};

/**
 * Human label for one granular permission entry. Stream permissions
 * render as "<level verb> “<stream name>”"; known feature permissions
 * get a dedicated wording, unknown ones fall back to `feature: setting`.
 */
export function permissionLabel(p: OfferPermission): string {
  if ("streamId" in p && typeof p.streamId === "string") {
    const target =
      p.streamId === "*" ? "all your data" : `“${p.name ?? p.defaultName ?? p.streamId}”`;
    return `${LEVEL_LABELS[p.level] ?? p.level} ${target}`;
  }
  const f = p as { feature: string; setting: string };
  if (f.feature === "selfRevoke" && f.setting === "forbidden") {
    return "The app cannot revoke its own access (only you can)";
  }
  return `${f.feature}: ${f.setting}`;
}

/** Pick the best language variant from a localized text map. */
export function pickText(t: LocalizableText | null, lang = "en"): string {
  if (t == null) return "";
  if (typeof t[lang] === "string") return t[lang];
  if (typeof t.en === "string") return t.en;
  const first = Object.values(t)[0];
  return typeof first === "string" ? first : "";
}
