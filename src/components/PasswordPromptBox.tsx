import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field } from "./ui";

/** The dialog `usePasswordPrompt` (./PasswordPrompt) shows for one question. */
export function PasswordDialog({
  message,
  confirmLabel,
  danger,
  onAnswer,
}: {
  message: ReactNode;
  confirmLabel?: string;
  danger: boolean;
  onAnswer: (password: string | null) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const boxRef = useRef<HTMLFormElement>(null);
  // Whether the current press started on the overlay itself.
  const pressedOutside = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(null);
      } else if (e.key === "Tab" && boxRef.current) {
        // Keep focus inside the dialog.
        const focusable = Array.from(
          boxRef.current.querySelectorAll<HTMLElement>("input, button:not([disabled])"),
        );
        if (focusable.length === 0) return;
        e.preventDefault();
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        const step = e.shiftKey ? -1 : 1;
        focusable[(at + step + focusable.length) % focusable.length].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onAnswer]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (password) onAnswer(password);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const outside = pressedOutside.current && e.target === e.currentTarget;
        pressedOutside.current = false;
        if (outside) onAnswer(null);
      }}
    >
      <form
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-message"
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-divider bg-card p-5 shadow-xl"
      >
        <p id="password-dialog-message" className="mb-4 text-sm">
          {message}
        </p>
        <Field
          id="password-dialog-input"
          label={t("common.password")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex gap-2">
          <Button variant="ghost" type="button" onClick={() => onAnswer(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} type="submit" disabled={!password}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </div>
      </form>
    </div>
  );
}
