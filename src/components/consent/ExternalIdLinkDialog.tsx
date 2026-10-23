import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ExternalIdLinkDialog,
  type ExternalIdLinkAnswer,
  type ExternalIdLinkQuestion,
} from "./ExternalIdLinkDialogBox";

export type { ExternalIdLinkAnswer, ExternalIdLinkQuestion } from "./ExternalIdLinkDialogBox";

/**
 * The "Link this record to your account?" dialog of `/auth`, shown before the
 * accept when the request carries an external id no account holds yet.
 *
 *   const [askLink, dialog] = useExternalIdLinkDialog();
 *   const answer = await askLink({ label, username, claim });
 *   ...
 *   return <>{dialog}...</>;
 *
 * Built-in, never a native dialog. Escape answers "Not now" while the
 * question is open, and "continue without linking" once a claim failed. A new
 * question replaces an unanswered one, which then answers "declined".
 */
export function useExternalIdLinkDialog(): [(q: ExternalIdLinkQuestion) => Promise<ExternalIdLinkAnswer>, ReactNode] {
  const [pending, setPending] = useState<ExternalIdLinkQuestion | null>(null);
  const resolver = useRef<((a: ExternalIdLinkAnswer) => void) | null>(null);

  const ask = useCallback(
    (q: ExternalIdLinkQuestion) =>
      new Promise<ExternalIdLinkAnswer>((resolve) => {
        resolver.current?.("declined");
        resolver.current = resolve;
        setPending(q);
      }),
    [],
  );

  // Stable, so the dialog's key handler is registered once per question.
  const answer = useCallback((a: ExternalIdLinkAnswer) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    resolve?.(a);
  }, []);

  const dialog = pending ? <ExternalIdLinkDialog question={pending} onAnswer={answer} /> : null;
  return [ask, dialog];
}
