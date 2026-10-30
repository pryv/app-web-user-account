import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../components/ui";
import { tNodes } from "../components/consent/tNodes";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { loggableError } from "../lib/apiError";
import { transferDecline, transferErrorMessage, transferLinkFrom, type TransferLink } from "../lib/accountTransfer";

/**
 * Landing page of an account transfer's decline link
 * (`/transfer-decline?username=<owner>&token=<t>`).
 *
 * The person named as beneficiary refuses to take the account over; the
 * platform tells its holder. No sign-in: the mailed token is the credential.
 * It is dropped from the address bar as soon as it is read (history,
 * Referer); the Decline button is the confirmation.
 */
export default function TransferDecline() {
  const { t } = useTranslation();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const [link] = useState<TransferLink | null>(() => transferLinkFrom(search));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Once, on mount: the token is already in state.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!params.has("token")) return;
    params.delete("token");
    const q = params.toString();
    navigate(pathname + (q ? `?${q}` : ""), { replace: true });
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
      setError(transferErrorMessage(err));
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
