import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../components/ui";
import { tNodes } from "../components/consent/tNodes";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { loggableError } from "../lib/apiError";
import {
  TRANSFER_ERRORS,
  searchWithoutLink,
  transferDecline,
  transferErrorId,
  transferErrorMessage,
  transferLinkFrom,
  type TransferLink,
} from "../lib/accountTransfer";

/**
 * Landing page of an account transfer's decline link
 * (`/transfer-decline?username=<owner>&token=<t>`).
 *
 * The person named as beneficiary refuses to take the account over; the
 * platform tells its holder. No sign-in: the mailed token is the credential.
 * The token and the owner's username are dropped from the address bar as soon
 * as they are read (history, Referer), as on the claim page; the Decline
 * button is the confirmation. Once the account was taken over (by this person
 * or another), it can no longer be declined.
 */
export default function TransferDecline() {
  const { t } = useTranslation();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const [link] = useState<TransferLink | null>(() => transferLinkFrom(search));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Once, on mount: the link is already in state.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!params.has("username") && !params.has("token")) return;
    navigate(pathname + searchWithoutLink(search), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decline() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const { appId } = parseAuthParams(search);
      const ownerApiEndpoint = await getService(search).apiEndpointFor(link.owner);
      await transferDecline(ownerApiEndpoint, appId, link.token);
      setDone(true);
    } catch (err: unknown) {
      console.warn("transfer-decline: the decline did not go through:", loggableError(err));
      setError(
        transferErrorId(err) === TRANSFER_ERRORS.claimed ? t("transfer.decline.alreadyTaken") : transferErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!link) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.decline.title")}</h1>
        <Alert>{t("transfer.linkIncomplete")}</Alert>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.decline.doneTitle")}</h1>
        <Alert tone="success">{t("transfer.decline.doneBody")}</Alert>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-2xl">{t("transfer.decline.title")}</h1>
      <p className="mb-4 text-sm" data-testid="transfer-decline-question">
        {tNodes("transfer.decline.question", { owner: <strong>{link.owner}</strong> })}
      </p>
      <p className="mb-4 text-sm text-muted">{t("transfer.decline.explain")}</p>
      {error && <Alert>{error}</Alert>}
      <Button type="button" variant="danger" onClick={() => void decline()} disabled={busy}>
        {busy ? t("transfer.decline.declining") : t("transfer.decline.button")}
      </Button>
    </Card>
  );
}
