import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

/** The dialog `useConfirm` (./ConfirmDialog) shows for one question. */
export function ConfirmDialog({
  message,
  confirmLabel,
  danger,
  onAnswer,
}: {
  message: ReactNode;
  confirmLabel?: string;
  danger: boolean;
  onAnswer: (ok: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Whether the current press started on the overlay itself.
  const pressedOutside = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(false);
      } else if (e.key === "Tab") {
        // Two buttons: keep focus between them.
        e.preventDefault();
        const next = document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current;
        next?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onAnswer]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const outside = pressedOutside.current && e.target === e.currentTarget;
        pressedOutside.current = false;
        if (outside) onAnswer(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        className="w-full max-w-sm rounded-lg border border-divider bg-card p-5 shadow-xl"
      >
        <p id="confirm-dialog-message" className="mb-4 text-sm">
          {message}
        </p>
        <div className="flex gap-2">
          <Button ref={cancelRef} variant="ghost" type="button" onClick={() => onAnswer(false)}>
            {t("common.cancel")}
          </Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} type="button" onClick={() => onAnswer(true)}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
