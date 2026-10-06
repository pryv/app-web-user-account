import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Field } from "../ui";

/** Where the account's missing address stands on the consent screen. */
export type MissingEmailState =
  | { kind: "missing" }
  | { kind: "adding" }
  | { kind: "added"; email: string }
  | { kind: "error"; message: string };

export interface MissingEmailNoticeProps {
  /** The account the consent is about, when it is not the person's own (null: "This account"). */
  username: string | null;
  /** Who will read the address: the requester (`user@host`) or the app's name. */
  appName: string;
  state: MissingEmailState;
  /** Make the typed address the account's email; the page moves `state` along. */
  onAdd: (email: string) => Promise<void>;
  disabled?: boolean;
}

/**
 * Said on a consent block whose permissions read the account's email when the
 * account has no address someone receives (see lib/accountEmail): who will
 * not be able to reach the person, and a one-field form to add an address
 * right there. Approving stays possible without one: the consent is the
 * person's to give, and ignoring the form is the way to decline it.
 */
export function MissingEmailNotice({ username, appName, state, onAdd, disabled = false }: MissingEmailNoticeProps) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState("");

  if (state.kind === "added") {
    return (
      <div data-testid="missing-email">
        <Alert tone="success">{t("consent.missingEmailAdded", { email: state.email })}</Alert>
      </div>
    );
  }

  const adding = state.kind === "adding";
  function submit(e: FormEvent) {
    e.preventDefault();
    const email = value.trim();
    if (email === "" || adding || disabled) return;
    void onAdd(email);
  }

  return (
    <div data-testid="missing-email">
      <Alert tone="info">
        <p>
          {username != null
            ? t("consent.missingEmailNoticeFor", { username, app: appName })
            : t("consent.missingEmailNotice", { app: appName })}
        </p>
        <p className="mt-1">{t("consent.missingEmailAddHint")}</p>
      </Alert>
      <form onSubmit={submit} className="mb-4" data-testid="missing-email-form">
        <Field
          id={id + "-email"}
          type="email"
          required
          label={t("consent.missingEmailLabel")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={adding || disabled}
        />
        {state.kind === "error" && <Alert>{state.message}</Alert>}
        <Button type="submit" variant="ghost" className="w-auto" disabled={adding || disabled}>
          {adding ? t("consent.missingEmailAdding") : t("consent.missingEmailAdd")}
        </Button>
      </form>
    </div>
  );
}
