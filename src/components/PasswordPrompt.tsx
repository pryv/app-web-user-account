import { useCallback, useRef, useState, type ReactNode } from "react";
import { PasswordDialog } from "./PasswordPromptBox";

type PromptOptions = { confirmLabel?: string; danger?: boolean };

/**
 * In-app password prompt, the password counterpart of `useConfirm`
 * (./ConfirmDialog), used instead of the browser's own prompt dialog (which
 * cannot mask the input and cannot follow the app's look or language).
 *
 *   const [askPassword, dialog] = usePasswordPrompt();
 *   const password = await askPassword(t("security.confirmDisable"), { confirmLabel: t("security.disable"), danger: true });
 *   if (password == null) return; // cancelled
 *   ...
 *   return <>{dialog}...</>;
 *
 * Escape, Cancel and a click outside answer null. A new question replaces an
 * unanswered one, which then answers null. The typed password lives only in
 * the dialog's state and is dropped when it closes.
 */
export function usePasswordPrompt(): [
  (message: ReactNode, opts?: PromptOptions) => Promise<string | null>,
  ReactNode,
] {
  const [pending, setPending] = useState<{ id: number; message: ReactNode; confirmLabel?: string; danger: boolean } | null>(null);
  const resolver = useRef<((password: string | null) => void) | null>(null);
  const nextId = useRef(0);

  const ask = useCallback(
    (message: ReactNode, opts?: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        // A fresh id per question: its dialog starts empty, never with what
        // was typed for a replaced one.
        nextId.current += 1;
        setPending({ id: nextId.current, message, confirmLabel: opts?.confirmLabel, danger: opts?.danger ?? false });
      }),
    [],
  );

  // Stable, so the dialog's focus effect runs once per question, not per render.
  const answer = useCallback((password: string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    resolve?.(password);
  }, []);

  const dialog = pending ? (
    <PasswordDialog
      key={pending.id}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onAnswer={answer}
    />
  ) : null;
  return [ask, dialog];
}
