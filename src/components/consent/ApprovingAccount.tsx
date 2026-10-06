import { useTranslation } from "react-i18next";
import { Alert, Button } from "../ui";
import { tNodes } from "./tNodes";
import type { ApprovingAccountView } from "../../lib/useApprovingAccount";

const LINK_BUTTON =
  "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

/**
 * Who answers, said right above the actions: while it is looked up, why they
 * are disabled; once known, "You are approving as {username}" with "Not you?
 * Switch account". Nothing when the page cannot answer with that account
 * (see `ApprovingAccountBlocked`).
 */
export function ApprovingAccountLine({ who, disabled = false }: { who: ApprovingAccountView; disabled?: boolean }) {
  const { t } = useTranslation();
  if (who.account.status === "loading") {
    return (
      <p className="mb-4 text-sm text-muted" data-testid="cmc-checking-account">
        {t("cmc.checkingAccount")}
      </p>
    );
  }
  if (!who.mayAnswer) return null;
  return (
    <p className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm" data-testid="cmc-approving-as">
      <span>{tNodes("cmc.approvingAs", { username: <strong>{who.signedInAs}</strong> })}</span>
      <button type="button" onClick={who.switchAccount} disabled={disabled} className={LINK_BUTTON}>
        {t("cmc.notYouSwitch")}
      </button>
    </p>
  );
}

/**
 * In place of the actions when the page cannot answer with the session: says
 * why (another account than the app expects, or one that could not be
 * confirmed) and offers to sign in as the right person.
 */
export function ApprovingAccountBlocked({ who }: { who: ApprovingAccountView }) {
  const { t } = useTranslation();
  return (
    <div data-testid="cmc-switch-account">
      <Alert tone="info">
        {who.wrongAccount
          ? tNodes("cmc.expectedOtherAccount", {
              expected: <strong>{who.expectedUsername}</strong>,
              username: <strong>{who.signedInAs}</strong>,
            })
          : t("cmc.accountUnconfirmed")}
      </Alert>
      <Button type="button" onClick={who.switchAccount}>
        {t("cmc.switchAccount")}
      </Button>
    </div>
  );
}
