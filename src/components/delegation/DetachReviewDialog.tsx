import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui";
import { PermissionList } from "../consent/PermissionList";
import { consentEntries } from "../../lib/consent";
import type { ConsentGrantReview } from "../../lib/delegation";

type Decision = "keep" | "drop";

/**
 * Review, before removing a delegate, of the consents that delegate gave for
 * this account (cross-account requests it accepted while acting for it).
 *
 * Each consent shows who asked, what it shares, when it was given and which
 * delegate approved it, with a Keep / Withdraw choice. Nothing is chosen in
 * advance: the removal stays disabled until every consent has a decision, so
 * a consent is never kept, or withdrawn, by default.
 */
export function DetachReviewDialog({
  username,
  grants,
  busy,
  onConfirm,
  onCancel,
}: {
  username: string;
  grants: ConsentGrantReview[];
  busy: boolean;
  /** Called with the ids of the consents to keep. */
  onConfirm: (keepAccessIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // A consent that never reached its requester cannot be kept: it has one outcome.
  const keepable = (g: ConsentGrantReview) => g.delivered !== false;
  const allDecided = grants.every((g) => !keepable(g) || decisions[g.accessId] != null);

  // Focus moves into the dialog and comes back where it was on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Escape cancels (not while removing); Tab stays inside the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = Array.from(
        boxRef.current.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled])"),
      );
      if (focusable.length === 0) {
        // Everything is disabled while removing: keep the focus in the dialog.
        e.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !boxRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !boxRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  function decide(accessId: string, decision: Decision) {
    setDecisions((prev) => ({ ...prev, [accessId]: decision }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div ref={boxRef} className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-divider bg-card p-6 shadow-lg">
        <h3 id={titleId} ref={titleRef} tabIndex={-1} className="mb-2 text-lg focus:outline-none">
          {t("delegation.reviewTitle", { username })}
        </h3>
        <p className="mb-4 text-sm text-muted">{t("delegation.reviewIntro", { username })}</p>
        <ul className="mb-4 min-h-0 space-y-4 overflow-y-auto">
          {grants.map((g) => (
            <li key={g.accessId} className="rounded border border-divider p-3" data-testid="detach-review-grant">
              <div className="font-medium">{t("delegation.reviewRequester", { requester: g.requester })}</div>
              <div className="mb-2 text-xs text-muted">
                {g.givenOnText && t("delegation.reviewGivenOn", { date: g.givenOnText })}
                {g.givenOnText && g.approvedBy && " · "}
                {g.approvedBy && t("delegation.reviewApprovedBy", { username: g.approvedBy })}
              </div>
              <PermissionList entries={consentEntries(g.permissions)} />
              {!keepable(g) && <p className="mt-2 text-sm text-muted">{t("delegation.reviewNotDelivered")}</p>}
              {keepable(g) && <fieldset className="mt-2 flex flex-col gap-1 sm:flex-row sm:gap-6">
                <legend className="sr-only">{t("delegation.reviewRequester", { requester: g.requester })}</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={"review-" + g.accessId}
                    value="keep"
                    checked={decisions[g.accessId] === "keep"}
                    onChange={() => decide(g.accessId, "keep")}
                    disabled={busy}
                  />
                  <span>
                    {t("delegation.reviewKeep")}
                    <span className="block text-xs text-muted">{t("delegation.reviewKeepHint")}</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name={"review-" + g.accessId}
                    value="drop"
                    checked={decisions[g.accessId] === "drop"}
                    onChange={() => decide(g.accessId, "drop")}
                    disabled={busy}
                  />
                  <span>
                    {t("delegation.reviewDrop")}
                    <span className="block text-xs text-muted">{t("delegation.reviewDropHint")}</span>
                  </span>
                </label>
              </fieldset>}
            </li>
          ))}
        </ul>
        {!allDecided && <p className="mb-3 text-xs text-muted">{t("delegation.reviewDecideAll")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onCancel} disabled={busy} className="w-auto">
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!allDecided || busy}
            onClick={() => onConfirm(grants.filter((g) => keepable(g) && decisions[g.accessId] === "keep").map((g) => g.accessId))}
            className="w-auto"
          >
            {busy ? t("delegation.reviewRemoving") : t("delegation.reviewConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
