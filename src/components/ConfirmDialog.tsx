import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialogBox";

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
