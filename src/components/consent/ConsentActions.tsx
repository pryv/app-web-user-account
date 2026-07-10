import { Button } from "../ui";

/**
 * The ONE Accept/Reject action pair for every consent surface. Labels
 * vary per flow (Accept/Reject vs Approve/Decline); busy wording and
 * styling do not.
 */
export function ConsentActions({
  busy,
  disabled = false,
  acceptLabel = "Accept",
  refuseLabel = "Reject",
  acceptId,
  refuseId,
  onAccept,
  onRefuse,
}: {
  /** Which action is in flight — disables both buttons. */
  busy: "accept" | "refuse" | null;
  /** Extra disable condition (e.g. offer not loaded yet). */
  disabled?: boolean;
  acceptLabel?: string;
  refuseLabel?: string;
  acceptId?: string;
  refuseId?: string;
  onAccept: () => void;
  onRefuse: () => void;
}) {
  const blocked = disabled || busy !== null;
  return (
    <div className="flex gap-3">
      <Button id={acceptId} type="button" disabled={blocked} onClick={onAccept}>
        {busy === "accept" ? "Approving…" : acceptLabel}
      </Button>
      <button
        id={refuseId}
        type="button"
        disabled={blocked}
        onClick={onRefuse}
        className="inline-flex w-full items-center justify-center rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {busy === "refuse" ? "Declining…" : refuseLabel}
      </button>
    </div>
  );
}
