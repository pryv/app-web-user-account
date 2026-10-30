import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../components/ui";
import { tNodes } from "../components/consent/tNodes";
import { ApprovingAccountBlocked } from "../components/consent/ApprovingAccount";
import { Delegation, Pryv } from "../lib/pryvClient";
import { useSession } from "../lib/useSession";
import { useApprovingAccount } from "../lib/useApprovingAccount";
import { signInLinkFor } from "../lib/handoffReturn";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { accountPath } from "../lib/sessionPaths";
import { storedServiceInfoUrl } from "../lib/sessionStore";
import { loggableError } from "../lib/apiError";
import {
  clearStoredClaim,
  isDefinitiveRefusal,
  readStoredClaim,
  runTransferClaim,
  searchWithoutLink,
  storeClaim,
  transferErrorMessage,
  transferLinkFrom,
  type TransferLink,
} from "../lib/accountTransfer";

const LINK_BUTTON =
  "inline-flex w-full items-center justify-center rounded px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

type Step = "claim" | "accept" | "complete";

/**
 * Landing page of an account transfer's claim link
 * (`/transfer-claim?username=<owner>&token=<t>`).
 *
 * The owner of an account chose to hand its management over to this person
 * at a date or after a period without use. Taking it over makes the
 * beneficiary's OWN account a delegate of the owner's, so they need an
 * account on this platform and must be signed in with it.
 *
 * The link's owner and token are moved into this tab's sessionStorage at once
 * and dropped from the address bar: the sign-in (or registration) hop must not
 * carry them (`/signin` reads `username` as a pre-fill hint, and the token
 * would reach the history and the Referer). `/signin` and `/register` come
 * back here through `next=/transfer-claim`.
 *
 * Until the platform answered, the page says nothing about the account beyond
 * its name. A session acting for another account cannot accept: the
 * beneficiary's own account is the one that takes over.
 */
export default function TransferClaim() {
  const { t } = useTranslation();
  const { connection, actingAs, backToParent } = useSession();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const [link] = useState<TransferLink | null>(() => transferLinkFrom(search) ?? readStoredClaim());
  const who = useApprovingAccount("/transfer-claim");

  const [step, setStep] = useState<Step | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; definitive: boolean } | null>(null);

  // Once, on mount: keep the link in the tab, out of the address bar.
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!params.has("username") && !params.has("token")) return;
    const fromUrl = transferLinkFrom(search);
    if (fromUrl) storeClaim(fromUrl);
    navigate(pathname + searchWithoutLink(search), { replace: true });
    // The link is already in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rest = searchWithoutLink(search);
  const registerLink = useMemo(() => {
    const params = new URLSearchParams(rest);
    params.set("next", "/transfer-claim");
    return `/register?${params.toString()}`;
  }, [rest]);

  if (!link) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.claim.title")}</h1>
        <Alert>{t("transfer.linkIncomplete")}</Alert>
      </Card>
    );
  }

  const intro = (
    <p className="mb-4 text-sm" data-testid="transfer-claim-intro">
      {tNodes("transfer.claim.intro", { owner: <strong>{link.owner}</strong> })}
    </p>
  );

  if (done) {
    const platform = parseAuthParams(search).serviceInfoUrl ?? storedServiceInfoUrl();
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.claim.doneTitle")}</h1>
        <Alert tone="success">{t("transfer.claim.doneBody", { owner: link.owner })}</Alert>
        <Link to={accountPath("/account/delegation", rest, platform)} className="text-sm text-primary hover:underline">
          {t("transfer.claim.openDelegation")}
        </Link>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.claim.title")}</h1>
        {intro}
        <p className="mb-4 text-sm text-muted">{t("transfer.claim.signInPrompt")}</p>
        <div className="flex flex-col gap-3">
          <Link to={signInLinkFor("/transfer-claim", rest)} className={`${LINK_BUTTON} bg-primary text-white hover:brightness-95`}>
            {t("transfer.claim.signIn")}
          </Link>
          <Link to={registerLink} className={`${LINK_BUTTON} text-primary hover:underline`}>
            {t("transfer.claim.register")}
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted">{t("transfer.claim.registerNote")}</p>
      </Card>
    );
  }

  if (actingAs) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("transfer.claim.title")}</h1>
        {intro}
        <Alert tone="info">{t("transfer.claim.actingAs", { username: actingAs.username })}</Alert>
        <Button type="button" onClick={backToParent}>
          {t("delegation.bannerBackTo", { username: actingAs.parentUsername })}
        </Button>
      </Card>
    );
  }

  async function accept() {
    if (!connection || !link || !who.signedInAs) return;
    setError(null);
    try {
      const { appId } = parseAuthParams(search);
      const ownerApiEndpoint = await getService(search).apiEndpointFor(link.owner);
      const client = Delegation.fromConnection(connection, { pryv: Pryv });
      await runTransferClaim({
        ownerApiEndpoint,
        appId,
        link,
        claimant: who.signedInAs,
        acceptAttach: (owner) => client.acceptAttach(owner),
        onStep: setStep,
      });
      clearStoredClaim();
      setDone(true);
    } catch (err: unknown) {
      console.warn("transfer-claim: the claim did not go through:", loggableError(err));
      const definitive = isDefinitiveRefusal(err);
      if (definitive) clearStoredClaim();
      setError({ message: transferErrorMessage(err), definitive });
    } finally {
      setStep(null);
    }
  }

  const busy = step != null;
  return (
    <Card>
      <h1 className="mb-2 text-2xl">{t("transfer.claim.title")}</h1>
      {intro}
      <p className="mb-4 text-sm text-muted">{t("transfer.claim.explain")}</p>
      {error && <Alert>{error.message}</Alert>}
      {busy && (
        <p className="mb-4 text-sm text-muted" role="status" data-testid="transfer-claim-progress">
          {t("transfer.claim.step." + step)}
        </p>
      )}
      {error?.definitive ? null : who.blocked ? (
        <ApprovingAccountBlocked who={who} />
      ) : who.account.status === "loading" ? (
        <p className="mb-4 text-sm text-muted">{t("cmc.checkingAccount")}</p>
      ) : (
        <>
          <Button type="button" onClick={() => void accept()} disabled={busy}>
            {busy ? t("transfer.claim.accepting") : t("transfer.claim.acceptAs", { username: who.signedInAs })}
          </Button>
          <p className="mt-3 text-center text-sm">
            <button
              type="button"
              onClick={who.switchAccount}
              disabled={busy}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {t("cmc.notYouSwitch")}
            </button>
          </p>
        </>
      )}
    </Card>
  );
}
