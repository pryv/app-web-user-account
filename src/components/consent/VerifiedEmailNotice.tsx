import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button } from "../ui";
import { formatDateTime } from "../../lib/dates";
import type { VerifiedEmailState } from "../../lib/useVerifiedEmail";
import { AddEmailForm, MissingEmailNotice, type MissingEmailState } from "./MissingEmailNotice";

export interface VerifiedEmailNoticeProps {
  /** The account the consent is about, when it is not the person's own (null: "this account"). */
  username: string | null;
  /** Who asks: the requester (`user@host`) or the app's name. */
  appName: string;
  state: VerifiedEmailState;
  /** The consent requires a verified address (otherwise it only reads the address). */
  required: boolean;
  /** Declining this consent refuses the whole request. */
  mandatory?: boolean;
  onAdd: (email: string) => void;
  onSend: () => void;
  onChange: () => void;
  /** Leave the form "Use another address" opened (shown only then). */
  onCancel?: () => void;
  onRetry: () => void;
  disabled?: boolean;
}

/** What a consent that only reads the address says: nothing, unless the account has none. */
function missingEmailState(state: VerifiedEmailState, takenText: string): MissingEmailState | null {
  switch (state.kind) {
    case "missing":
    case "adding":
      return { kind: state.kind };
    case "added":
      return { kind: "added", email: state.email };
    case "proved":
      return state.here ? { kind: "added", email: state.email } : null;
    case "taken":
      return state.viaAdd ? { kind: "error", message: takenText } : null;
    case "error":
      return state.at === "add" ? { kind: "error", message: state.message } : null;
    default:
      return null;
  }
}

/**
 * The account's email address, on a consent block that requires a verified one
 * or reads it (see lib/useVerifiedEmail). Required: where the address stands
 * and the step that gets it verified; approving waits for it. Only read: said
 * when the account has no address, and approving stays possible.
 */
export function VerifiedEmailNotice({
  username,
  appName,
  state,
  required,
  mandatory = false,
  onAdd,
  onSend,
  onChange,
  onCancel,
  onRetry,
  disabled = false,
}: VerifiedEmailNoticeProps) {
  const { t } = useTranslation();
  const changing = "changing" in state && state.changing === true;

  if (!required) {
    const plain = missingEmailState(state, t("consent.emailTaken"));
    if (plain != null) {
      return (
        <MissingEmailNotice
          username={username}
          appName={appName}
          state={plain}
          onAdd={onAdd}
          onCancel={changing ? onCancel : undefined}
          disabled={disabled}
        />
      );
    }
    // Only an address being added concerns this consent.
    if (!("viaAdd" in state) || !state.viaAdd) return null;
  }

  if (state.kind === "checking") return null;
  if (state.kind === "proved") {
    return (
      <div data-testid="verified-email" data-state="proved">
        <Alert tone="success">{t("consent.verifyEmailProved", { email: state.email })}</Alert>
      </div>
    );
  }

  const statusText = (): string | null => {
    switch (state.kind) {
      case "unproved":
        return t("consent.verifyEmailUnproved", { email: state.email });
      case "missing":
      case "adding":
        return t("consent.verifyEmailMissing");
      case "waiting":
      case "sending":
        return state.kind === "waiting" ? t("consent.verifyEmailWaiting", { email: state.email }) : null;
      case "cooldown":
        return t("consent.verifyEmailCooldown", { email: state.email, time: formatDateTime(Math.ceil(state.until)) });
      case "unavailable":
        return t("consent.verifyEmailUnavailable");
      default:
        return null;
    }
  };
  const status = statusText();

  const sendButton = (label: string, off: boolean): ReactNode => (
    <Button type="button" variant="ghost" className="w-auto" onClick={onSend} disabled={off || disabled}>
      {label}
    </Button>
  );
  // Also for the account's own address: one typed wrong cannot be verified.
  const otherButton = (required || ("viaAdd" in state && state.viaAdd)) && (
    <Button type="button" variant="ghost" className="w-auto" onClick={onChange} disabled={disabled}>
      {t("consent.verifyEmailOther")}
    </Button>
  );

  const showsForm =
    state.kind === "missing" ||
    state.kind === "adding" ||
    state.kind === "taken" ||
    (state.kind === "error" && state.at === "add");
  const formError =
    state.kind === "taken" ? t("consent.emailTaken") : state.kind === "error" ? state.message : null;

  return (
    <div data-testid="verified-email" data-state={state.kind}>
      {(required || status != null) && (
        // Required and not proved (a proof returned above): Approve is blocked, so a warning.
        <Alert tone={required ? "warning" : "info"}>
          {required && (
            <p>
              {username != null
                ? t("consent.verifyEmailNeededFor", { username, app: appName })
                : t("consent.verifyEmailNeeded", { app: appName })}
            </p>
          )}
          {required && mandatory && <p className="mt-1">{t("consent.verifyEmailMandatory")}</p>}
          {status != null && <p className="mt-1">{status}</p>}
          {required && state.kind === "waiting" && <p className="mt-1">{t("consent.verifyEmailComeBack")}</p>}
        </Alert>
      )}
      {showsForm && (
        <AddEmailForm
          testId="verified-email-form"
          initialValue={state.kind === "missing" ? state.suggested ?? "" : ""}
          adding={state.kind === "adding"}
          error={formError}
          onAdd={onAdd}
          onCancel={changing ? onCancel : undefined}
          disabled={disabled}
        />
      )}
      {state.kind === "error" && !showsForm && (
        <>
          <Alert>{state.message}</Alert>
          <div className="mb-4">
            <Button type="button" variant="ghost" className="w-auto" onClick={onRetry} disabled={disabled}>
              {t("consent.verifyEmailRetry")}
            </Button>
          </div>
        </>
      )}
      {(state.kind === "unproved" ||
        state.kind === "sending" ||
        state.kind === "waiting" ||
        state.kind === "cooldown") && (
        <div className="mb-4 flex flex-wrap gap-2">
          {state.kind === "unproved" && sendButton(t("consent.verifyEmailSend"), false)}
          {state.kind === "sending" && sendButton(t("consent.verifyEmailSending"), true)}
          {state.kind === "waiting" && state.canSendAgain && sendButton(t("consent.verifyEmailSendAgain"), false)}
          {state.kind === "cooldown" && sendButton(t("consent.verifyEmailSendAgain"), true)}
          {state.kind !== "sending" && otherButton}
        </div>
      )}
    </div>
  );
}
