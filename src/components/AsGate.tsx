import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, Button, Alert } from "./ui";
import { tNodes } from "./consent/tNodes";
import type { AsResolution, AsState } from "../lib/useAuditAs";

/**
 * What a page shows while `as` is being resolved or offered (the checking
 * card, the "Open as" card), or null once the page may render its content.
 * The card's heading takes the focus once, when the offer shows.
 */
export function AsGate({ as, children }: { as: AsResolution; children?: ReactNode }) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const { state } = as;
  useEffect(() => {
    // Once (a page shows at most one offer, `as` being read once): a failed Open
    // comes back to the card without taking the focus away from where the person
    // is (the error is announced as an alert).
    if (state.kind === "offer" && !focused.current) {
      focused.current = true;
      heading.current?.focus();
    }
  }, [state.kind]);

  if (state.kind === "checking") {
    return (
      <section className="space-y-4">
        {children}
        <Card>
          <p className="text-sm text-muted">{t("audit.asChecking")}</p>
        </Card>
      </section>
    );
  }
  if (state.kind !== "offer" && state.kind !== "opening") return null;
  const name = <strong>{state.username}</strong>;
  return (
    <section className="space-y-4">
      {children}
      <Card>
        <h2 ref={heading} tabIndex={-1} className="mb-2 text-lg font-medium focus:outline-none">
          {tNodes("audit.asOfferTitle", { username: name })}
          {state.hostSlug && <span className="text-sm font-normal text-muted"> · {state.hostSlug}</span>}
        </h2>
        <p className="mb-4 text-sm">{tNodes("audit.asOfferBody", { username: name })}</p>
        {state.kind === "offer" && state.error && <Alert>{state.error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="w-auto"
            disabled={state.kind === "opening"}
            onClick={() => void as.openAs(state.username, state.hostSlug)}
          >
            {state.kind === "opening" ? t("audit.asOpening") : tNodes("audit.asOfferOpen", { username: state.username })}
          </Button>
          <Button type="button" variant="ghost" className="w-auto" disabled={state.kind === "opening"} onClick={as.stay}>
            {t("audit.asOfferStay")}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** The notice left once `as` is resolved without a switch (not managed, list failed, ignored). */
export function AsNotice({ state }: { state: AsState }) {
  const { t } = useTranslation();
  if (state.kind === "not-managed") {
    return <Alert tone="info">{tNodes("audit.asNotManaged", { username: <strong>{state.username}</strong> })}</Alert>;
  }
  if (state.kind === "list-failed") {
    return <Alert tone="info">{tNodes("audit.asListFailed", { username: <strong>{state.username}</strong> })}</Alert>;
  }
  if (state.kind === "ignored") return <Alert tone="info">{t("audit.asIgnored")}</Alert>;
  return null;
}
