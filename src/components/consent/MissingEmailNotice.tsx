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
  onAdd: (email: string) => void;
  /** Leave the form for where the account stood (offered only when given). */
  onCancel?: () => void;
  disabled?: boolean;
}

/** The one-field form adding an address, shared by the consent screens' email notices. */
export function AddEmailForm({
  testId,
  initialValue = "",
  adding,
  error,
  onAdd,
  onCancel,
  disabled = false,
}: {
  testId: string;
  initialValue?: string;
  adding: boolean;
  /** Why the last address was refused. */
  error: string | null;
  onAdd: (email: string) => void;
  /** Leave the form without adding (a Cancel is shown only when given). */
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const errorId = id + "-error";
  function submit(e: FormEvent) {
    e.preventDefault();
    const email = value.trim();
    if (email === "" || adding || disabled) return;
    onAdd(email);
  }
  return (
    <form onSubmit={submit} className="mb-4" data-testid={testId}>
      <Field
        id={id + "-email"}
        type="email"
        required
        label={t("consent.missingEmailLabel")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={adding || disabled}
        aria-invalid={error != null ? true : undefined}
        aria-describedby={error != null ? errorId : undefined}
      />
      {error != null && (
        <div id={errorId}>
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="ghost" className="w-auto" disabled={adding || disabled}>
          {adding ? t("consent.missingEmailAdding") : t("consent.missingEmailAdd")}
        </Button>
        {onCancel != null && (
          <Button type="button" variant="ghost" className="w-auto" onClick={onCancel} disabled={adding || disabled}>
            {t("consent.emailFormCancel")}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Said on a consent block whose permissions read the account's email when the
 * account has no address someone receives (see lib/accountEmail): who will
 * not be able to reach the person, and a one-field form to add an address
 * right there. Approving stays possible without one: the consent is the
 * person's to give, and ignoring the form is the way to decline it.
 */
export function MissingEmailNotice({ username, appName, state, onAdd, onCancel, disabled = false }: MissingEmailNoticeProps) {
  const { t } = useTranslation();

  if (state.kind === "added") {
    return (
      <div data-testid="missing-email">
        <Alert tone="success">{t("consent.missingEmailAdded", { email: state.email })}</Alert>
      </div>
    );
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
      <AddEmailForm
        testId="missing-email-form"
        adding={state.kind === "adding"}
        error={state.kind === "error" ? state.message : null}
        onAdd={onAdd}
        onCancel={onCancel}
        disabled={disabled}
      />
    </div>
  );
}
