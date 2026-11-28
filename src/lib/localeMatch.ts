/**
 * The one rule every per-language map of this app is read with (catalogue
 * texts, offer texts, legal links): given the UI language, which of the map's
 * keys to use.
 *
 * Order: the full tag (`pt-BR`), then its base (`pt`), then another region of
 * the same base (`pt-PT`), then English (`en`, then another `en-*`). Tags are
 * compared case-insensitively and `_` reads as `-` (`pt_br` is `pt-BR`).
 * Nothing else is guessed: a map holding neither the language nor English
 * gives nothing, and the caller decides what to fall back to.
 */

/** A language tag as compared here: lower case, `-` as separator. */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/_/g, "-").toLowerCase();
}

function baseOf(tag: string): string {
  return tag.split("-")[0];
}

/**
 * The map's keys in the order they are tried for `lang` (see the module
 * comment); keys that match nothing are left out. Within "another region of
 * the same base", the map's own order decides.
 */
export function localeCandidates(keys: readonly string[], lang: string): string[] {
  const normalized = keys.map((k) => ({ key: k, tag: normalizeTag(k) }));
  const out: string[] = [];
  const take = (match: (tag: string) => boolean) => {
    for (const { key, tag } of normalized) if (match(tag) && !out.includes(key)) out.push(key);
  };
  const chain = (wanted: string) => {
    if (wanted === "") return;
    const base = baseOf(wanted);
    take((tag) => tag === wanted);
    take((tag) => tag === base);
    take((tag) => baseOf(tag) === base);
  };
  chain(normalizeTag(lang));
  chain("en");
  return out;
}

/**
 * The value of `map` for `lang`, the first candidate key (see
 * {@link localeCandidates}) whose value `usable` accepts, or undefined.
 */
export function pickLocalized<T>(
  map: Readonly<Record<string, unknown>>,
  lang: string,
  usable: (value: unknown) => value is T,
): T | undefined {
  for (const key of localeCandidates(Object.keys(map), lang)) {
    const value = map[key];
    if (usable(value)) return value;
  }
  return undefined;
}

/** A string, the empty one included. */
export const isString = (v: unknown): v is string => typeof v === "string";

/** A string that is not empty. */
export const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";
