import type { ConsentEntry } from "../../lib/consent";

/**
 * The ONE permission render for every consent surface (full lexicon:
 * stream AND feature permissions, mandatory entries locked).
 *
 * Two visual modes:
 *   - with `onToggle` — checkbox rows: locked entries are checked+disabled,
 *     unlocked ones follow `flags`. Checkbox ids are `${idPrefix}-${i}`
 *     (the OAuth flow passes `oauthScope` for rig/e2e continuity).
 *   - without `onToggle` — plain read-only rows (all-or-nothing surfaces
 *     where no per-entry choice exists).
 */
export function PermissionList({
  entries,
  flags,
  onToggle,
  idPrefix = "consentScope",
}: {
  entries: ConsentEntry[];
  flags?: boolean[];
  onToggle?: (index: number, checked: boolean) => void;
  idPrefix?: string;
}) {
  return (
    <ul className="mb-2 space-y-1 text-sm">
      {entries.map((e, i) => (
        <li key={i} className="rounded bg-body px-3 py-2 break-all">
          {onToggle ? (
            <label className="flex items-center gap-2">
              <input
                id={idPrefix + "-" + i}
                type="checkbox"
                checked={e.locked || (flags?.[i] ?? true)}
                disabled={e.locked}
                onChange={(ev) => onToggle(i, ev.target.checked)}
              />
              <span>{e.label}</span>
              {e.showRequiredHint && (
                <span className="text-xs text-muted">(required by this app)</span>
              )}
            </label>
          ) : (
            <span>{e.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
