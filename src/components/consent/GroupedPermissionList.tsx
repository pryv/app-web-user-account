import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  consentGroupCounts,
  groupTickState,
  levelLabel,
  type ConsentEntry,
  type ConsentGroupCounts,
  type ConsentGroupView,
  type ConsentLayout,
} from "../../lib/consent";
import { PermissionRow } from "./PermissionList";

/**
 * The permission list in the groups the offer declares (see `consentLayout`):
 * entries no group names first, then one fieldset per group, then the
 * feature restrictions no group names.
 *
 * Each group's legend states its label and every count the decision needs,
 * so nothing lives only in a collapsed group. A group of more than one entry
 * opens collapsed; its toggle is a button with `aria-expanded` and
 * `aria-controls`, and the collapsed rows are `hidden` (out of the tab order).
 * Expanded, the rows are the flat list's own (`PermissionRow`, same element
 * ids on the flat index).
 *
 * With a choice (`allowUserChoice`), each group with an entry the user may
 * untick gets a tri-state box: checked when every such entry is ticked,
 * unchecked when none is, otherwise mixed (`indeterminate`,
 * `aria-checked="mixed"`). Setting it ticks or unticks those entries only;
 * locked entries never change. Without a choice there are no boxes at all.
 */
export function GroupedPermissionList({
  entries,
  flags,
  layout,
  allowUserChoice,
  onToggle,
  onToggleGroup,
  idPrefix = "consentScope",
}: {
  entries: ConsentEntry[];
  flags: boolean[];
  layout: ConsentLayout;
  allowUserChoice: boolean;
  onToggle: (index: number, checked: boolean) => void;
  onToggleGroup: (indices: number[], checked: boolean) => void;
  idPrefix?: string;
}) {
  const rowToggle = allowUserChoice ? onToggle : undefined;
  const rows = (indices: number[]) =>
    indices.map((i) => (
      <PermissionRow key={i} entry={entries[i]} index={i} flags={flags} onToggle={rowToggle} idPrefix={idPrefix} />
    ));
  return (
    <div className="mb-2 text-sm">
      {layout.ungrouped.length > 0 && <ul className="mb-2 space-y-1">{rows(layout.ungrouped)}</ul>}
      {layout.groups.map((g, gi) => (
        <EntryGroup
          key={g.key}
          group={g}
          baseId={`${idPrefix}-group-${gi}`}
          counts={consentGroupCounts(entries, g.indices, allowUserChoice)}
          tickState={allowUserChoice ? groupTickState(entries, g.indices, flags) : null}
          onToggleGroup={(checked) => onToggleGroup(g.indices, checked)}
        >
          {rows(g.indices)}
        </EntryGroup>
      ))}
      {layout.restrictions.length > 0 && <ul className="mb-2 space-y-1">{rows(layout.restrictions)}</ul>}
    </div>
  );
}

function EntryGroup({
  group,
  baseId,
  counts,
  tickState,
  onToggleGroup,
  children,
}: {
  group: ConsentGroupView;
  baseId: string;
  counts: ConsentGroupCounts;
  tickState: "checked" | "unchecked" | "mixed" | null;
  onToggleGroup: (checked: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(group.indices.length <= 1);
  const listId = `${baseId}-entries`;
  const summaryId = `${baseId}-summary`;
  return (
    <fieldset id={baseId} className="mb-2 rounded border border-divider px-3 pt-1 pb-2">
      <legend className="px-1">
        {tickState != null ? (
          <label className="inline-flex items-center gap-2 font-medium">
            <input
              id={`${baseId}-box`}
              type="checkbox"
              checked={tickState === "checked"}
              aria-checked={tickState === "mixed" ? "mixed" : tickState === "checked"}
              aria-describedby={summaryId}
              ref={(el) => {
                if (el) el.indeterminate = tickState === "mixed";
              }}
              onChange={(ev) => onToggleGroup(ev.target.checked)}
            />
            <span>{group.label}</span>
          </label>
        ) : (
          <span className="font-medium">{group.label}</span>
        )}{" "}
        <span id={summaryId} className="text-xs text-muted">{groupSummary(t, counts)}</span>
      </legend>
      <button
        id={`${baseId}-toggle`}
        type="button"
        className="mb-1 text-xs underline"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        {open ? t("consent.groupHide") : t("consent.groupShow", { count: counts.total })}
      </button>
      <ul id={listId} className="space-y-1" hidden={!open}>
        {children}
      </ul>
    </fieldset>
  );
}

type T = (key: string, vars?: Record<string, unknown>) => string;

/** The legend's counts, e.g. "12 entries (Read: 10, Add and modify: 2); 1 required, 9 already allowed". */
function groupSummary(t: T, c: ConsentGroupCounts): string {
  const breakdown = [
    ...c.levels.map((l) => t("consent.groupLevelCount", { level: levelLabel(l.level), count: l.count })),
    ...(c.restrictions > 0 ? [t("consent.groupRestrictions", { count: c.restrictions })] : []),
    ...(c.otherFeatures > 0 ? [t("consent.groupOtherFeatures", { count: c.otherFeatures })] : []),
  ];
  const decision = [
    ...(c.required ? [t("consent.groupRequired", { count: c.required })] : []),
    ...(c.alreadyAllowed > 0 ? [t("consent.groupAlreadyAllowed", { count: c.alreadyAllowed })] : []),
    ...(c.fresh ? [t("consent.groupFresh", { count: c.fresh })] : []),
  ];
  const line = t("consent.groupSummary", {
    entries: t("consent.groupEntries", { count: c.total }),
    breakdown: breakdown.join(", "),
  });
  return decision.length > 0 ? t("consent.groupSummaryDecision", { summary: line, decision: decision.join(", ") }) : line;
}
