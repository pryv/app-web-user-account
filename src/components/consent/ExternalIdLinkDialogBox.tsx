import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button } from "../ui";
import { tNodes } from "./tNodes";
import type { ClaimOutcome } from "../../lib/externalId";

/**
 * How the question ended: linked, declined ("Not now"), or not linked because
 * the claim could not be made (the user chose to continue without it).
 */
export type ExternalIdLinkAnswer = "linked" | "declined" | "not-linked";

export interface ExternalIdLinkQuestion {
  /** The namespace's display name. */
  label: string;
  /** The account about to be linked. */
  username: string;
  /** Makes the claim; the dialog shows what it answered. */
  claim: () => Promise<ClaimOutcome>;
}

/** The dialog `useExternalIdLinkDialog` (./ExternalIdLinkDialog) shows for one question. */
export function ExternalIdLinkDialog({
  question,
  onAnswer,
}: {
  question: ExternalIdLinkQuestion;
  onAnswer: (a: ExternalIdLinkAnswer) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [linking, setLinking] = useState(false);
  // What the last claim answered, when it did not link.
  const [failure, setFailure] = useState<Exclude<ClaimOutcome, "linked"> | null>(null);
  // Read from the key handler without re-registering it on every change.
  const stateRef = useRef({ linking, failure });
  useEffect(() => {
    stateRef.current = { linking, failure };
  }, [linking, failure]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (stateRef.current.linking) return;
        onAnswer(stateRef.current.failure != null ? "not-linked" : "declined");
      } else if (e.key === "Tab" && boxRef.current) {
        // Keep focus inside the dialog.
        const focusable = Array.from(boxRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
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

  // Focus the main action, again when the buttons change (question, then failure).
  useEffect(() => {
    if (!linking) boxRef.current?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
  }, [linking, failure]);

  async function link() {
    setLinking(true);
    setFailure(null);
    let outcome: ClaimOutcome;
    try {
      outcome = await question.claim();
    } catch {
      outcome = "failed";
    }
    if (outcome === "linked") {
      onAnswer("linked");
      return;
    }
    setFailure(outcome);
    setLinking(false);
  }

  const failureMessage =
    failure === "value-taken"
      ? t("externalId.errorValueTaken")
      : failure === "namespace-taken"
        ? t("externalId.errorNamespaceTaken", { label: question.label })
        : failure === "rate-limited"
          ? t("externalId.errorRateLimited")
          : failure === "failed"
            ? t("externalId.errorFailed")
            : null;
  // A refusal (the id or the namespace is taken) will not change on a retry.
  const retryable = failure === "rate-limited" || failure === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-id-dialog-title"
        aria-describedby="external-id-dialog-body"
        data-testid="external-id-dialog"
        className="w-full max-w-sm rounded-lg border border-divider bg-card p-5 shadow-xl"
      >
        <h2 id="external-id-dialog-title" className="mb-2 text-base font-semibold">
          {t("externalId.linkTitle")}
        </h2>
        <div id="external-id-dialog-body" className="mb-4 space-y-2 text-sm">
          <p>
            {tNodes("externalId.linkBody", {
              label: <strong>{question.label}</strong>,
              username: <strong>{question.username}</strong>,
            })}
          </p>
          <p className="text-muted">{t("externalId.linkConsequence")}</p>
        </div>
        {failureMessage != null && <Alert>{failureMessage}</Alert>}
        <div className="flex gap-2">
          {failure == null ? (
            <>
              <Button variant="ghost" type="button" onClick={() => onAnswer("declined")} disabled={linking}>
                {t("externalId.notNow")}
              </Button>
              <Button data-primary type="button" onClick={() => void link()} disabled={linking}>
                {linking ? t("externalId.linking") : t("externalId.link")}
              </Button>
            </>
          ) : retryable ? (
            <>
              <Button variant="ghost" type="button" onClick={() => onAnswer("not-linked")}>
                {t("externalId.continueWithoutLinking")}
              </Button>
              <Button data-primary type="button" onClick={() => void link()}>
                {t("externalId.retry")}
              </Button>
            </>
          ) : (
            <Button data-primary type="button" onClick={() => onAnswer("not-linked")}>
              {t("externalId.continue")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
