import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

/**
 * In-app confirmation dialog, used instead of `window.confirm()` (which blocks
 * the page and cannot follow the app's look or language).
 *
 *   const [confirm, dialog] = useConfirm();
 *   if (!(await confirm(t("audit.confirmRevoke"), { confirmLabel: t("audit.revoke") }))) return;
 *   ...
 *   return <>{dialog}...</>;
 *
 * Escape, Cancel and a click outside answer false (a text-selection drag that
 * starts inside the box and ends outside is not a click outside). A new question replaces
 * an unanswered one, which then answers false.
 */
export function useConfirm(): [
  (message: ReactNode, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>,
  ReactNode,
] {
  const [pending, setPending] = useState<{ message: ReactNode; confirmLabel?: string; danger: boolean } | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (message: ReactNode, opts?: { confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setPending({ message, confirmLabel: opts?.confirmLabel, danger: opts?.danger ?? false });
      }),
    [],
  );

  // Stable, so the dialog's focus effect runs once per question, not per render.
  const answer = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    resolve?.(ok);
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onAnswer={answer}
    />
  ) : null;
  return [confirm, dialog];
}

function ConfirmDialog({
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
