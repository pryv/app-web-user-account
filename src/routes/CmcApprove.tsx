import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Link, useLocation } from "react-router-dom";
import { cmc } from "../lib/pryvClient";
import { Card, Alert, Button } from "../components/ui";
import { useSession } from "../lib/useSession";
import { storedServiceInfoUrl } from "../lib/sessionStore";
import { CmcOfferBlock, type CmcOfferView } from "../components/consent/CmcOfferBlock";
import { trustedOpenerOrigin } from "../lib/safeRedirect";
import { navigateTo, resultReturn, type ReturnOutcome } from "../lib/returnTarget";
import { ReturnNotice } from "../components/consent/ReturnNotice";
import { signInLinkFor } from "../lib/handoffReturn";
import { useApprovingAccount } from "../lib/useApprovingAccount";
import { ApprovingAccountBlocked, ApprovingAccountLine } from "../components/consent/ApprovingAccount";
import { inviteFailure, OFFER_UNREADABLE_KEY, type InviteFailure } from "../lib/cmcAccept";
import { loggableError, platformError } from "../lib/apiError";
import { hasUsableEmail, missingEmailErrorKey, readsAccountEmail } from "../lib/accountEmail";
import { maskUrlCredentials } from "../lib/maskCredentials";
import { MissingEmailNotice, type MissingEmailState } from "../components/consent/MissingEmailNotice";
import { useStreamLabels } from "../lib/useConsentDisplay";

/**
 * What the page hands back to the app that sent the invite: the outcome only.
 * `acceptEventId` is an id on the ACCEPTING account; the requester obtains its
 * data-grant endpoint on its own side (@pryv/cmc `waitForAccept`), never
 * through this browser hand-off, so nothing here is a credential.
 */
interface AcceptOutcome {
  ok: boolean;
  acceptEventId?: string;
  reason?: string;
}

function outcomePayload(res: AcceptOutcome): AcceptOutcome {
  const out: AcceptOutcome = { ok: res.ok };
  if (res.acceptEventId != null) out.acceptEventId = res.acceptEventId;
  if (res.reason != null) out.reason = res.reason;
  return out;
}

interface AcceptParams {
  capabilityUrl: string | null;
  scopeStreamId: string | null;
  accessName: string | null;
  returnUrl: string | null;
  mode: "popup" | "redirect";
}

function parseCmcParams(search: string): AcceptParams {
  const p = new URLSearchParams(search);
  const returnUrl = p.get("returnUrl");
  const mode = (p.get("mode") as "popup" | "redirect" | null) ?? (returnUrl ? "redirect" : "popup");
  return {
    capabilityUrl: p.get("capabilityUrl") ?? p.get("capability"),
    scopeStreamId: p.get("scopeStreamId"),
    accessName: p.get("accessName"),
    returnUrl,
    mode,
  };
}

/** A failed call's result row as an error carrying the platform's id (read by `platformError`). */
function rowError(error: { id?: string; message?: string }, fallback: string): Error {
  return Object.assign(new Error(error.message ?? fallback), { id: error.id });
}

/**
 * Hand the outcome back; in redirect mode, under the operator's return
 * policy. Returns what the page shows when it did not leave, else null.
 */
function deliverResult(res: AcceptOutcome, params: AcceptParams): ReturnOutcome | null {
  const payload = outcomePayload(res);
  if (params.mode === "redirect" && params.returnUrl) {
    // An absolute http(s) URL only (a `javascript:` / `data:` value would
    // execute in this trusted origin), then as the operator's policy says.
    const outcome = resultReturn(params.returnUrl, "cmcAcceptResult", payload, "cmc-accept");
    if (outcome.kind !== "follow") return outcome;
    navigateTo(outcome.href);
    return null;
  }
  if (window.opener) {
    // Pin to the REAL opener (referrer) first; `returnUrl` is only a fallback
    // pin hint, and the one used after `/auth` continued here in the same
    // window (the referrer is then this app itself, not the opener). With no
    // derivable origin the outcome (no credential) goes to '*'.
    const pinOrigin = trustedOpenerOrigin(params.returnUrl, document.referrer);
    window.opener.postMessage({ type: "cmc-accept-result", ...payload }, pinOrigin ?? "*");
    window.close();
  }
  return null;
}

/**
 * Cross-account approval. Reads the capability offer, lets the subject Approve
 * or Decline, and reports the outcome back via the @pryv/cmc hand-off contract
 * (popup postMessage / redirect with `?cmcAcceptResult=<json>`).
 *
 * Permission render + Approve/Decline come from the shared consent kit.
 * The `@pryv/cmc` accept contract is all-or-nothing (no granted subset on
 * the accept trigger), so every entry renders locked.
 *
 * Unlike the OAuth consent (always a fresh sign-in), this surface reuses the
 * persisted account session. Nothing in the link binds the offer to an
 * account: an open-link invite can be accepted by anyone, so whoever is
 * signed in in this browser would answer it. The page therefore names the
 * account that answers above Approve / Decline, with "Not you? Switch
 * account", and offers neither until that account is known. When the calling
 * app names the account it expects (`username=`) and the session is another
 * one, it asks to switch account instead.
 */
export default function CmcApprove() {
  const { t } = useTranslation();
  const { connection, actingAs } = useSession();
  const { search } = useLocation();
  const params = parseCmcParams(search);

  const [offer, setOffer] = useState<CmcOfferView | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [error, setError] = useState<Omit<InviteFailure, "reason"> | null>(null);
  const [working, setWorking] = useState<"accept" | "refuse" | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);
  const [returnOutcome, setReturnOutcome] = useState<ReturnOutcome | null>(null);
  const labelFor = useStreamLabels(storedServiceInfoUrl());

  function deliver(res: AcceptOutcome): void {
    setReturnOutcome(deliverResult(res, params));
  }

  // Always try to read the offer (anonymous read via the capability access).
  useEffect(() => {
    if (!params.capabilityUrl) return;
    setLoadingOffer(true);
    cmc
      .readOffer(params.capabilityUrl)
      .then((o: unknown) => setOffer(o as CmcOfferView))
      .catch((err: unknown) => {
        console.warn("cmc-accept: could not read the offer:", loggableError(err));
        setError({ message: i18n.t(OFFER_UNREADABLE_KEY), tone: "danger" });
      })
      .finally(() => setLoadingOffer(false));
  }, [params.capabilityUrl]);

  // An offer that reads the account's email, on an account with no address
  // someone receives: said on the block, with a way to add one (best-effort:
  // when the account cannot be read, nothing is said).
  const [emailState, setEmailState] = useState<MissingEmailState | null>(null);
  const offerReadsEmail = offer != null && readsAccountEmail(offer.requestedPermissions);
  const accountEndpoint = connection?.apiEndpoint ?? null;
  useEffect(() => {
    setEmailState(null);
    if (!connection || !offerReadsEmail) return;
    let cancelled = false;
    void (async () => {
      try {
        const [res] = (await connection.api([{ method: "account.get", params: {} }])) as Array<{
          account?: { email?: string | null };
          error?: { id?: string; message?: string };
        }>;
        if (res?.error) throw rowError(res.error, "account.get failed");
        if (!cancelled && !hasUsableEmail(res?.account)) setEmailState({ kind: "missing" });
      } catch (err: unknown) {
        console.warn("cmc-accept: could not read the account's email:", loggableError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // The session's account (its endpoint) and the offer decide; the object identity does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerReadsEmail, accountEndpoint]);

  // The account that answers: whichever session this browser holds, which is
  // not necessarily the person the invite was meant for.
  const who = useApprovingAccount("/cmc-accept");
  const { signedInAs, mayAnswer, switchAccount } = who;

  async function addEmail(email: string) {
    if (!connection) return;
    setEmailState({ kind: "adding" });
    try {
      const [res] = (await connection.api([
        { method: "account.update", params: { update: { email } } },
      ])) as Array<{ account?: { email?: string }; error?: { id?: string; message?: string } }>;
      if (res?.error) throw rowError(res.error, "account.update failed");
      setEmailState({ kind: "added", email: res?.account?.email ?? email });
    } catch (err: unknown) {
      console.warn("cmc-accept: could not add the account's email:", loggableError(err));
      const key = missingEmailErrorKey(err);
      setEmailState({
        kind: "error",
        message: key === "consent.emailTaken" ? t(key) : maskUrlCredentials(platformError(err, t(key)).message),
      });
    }
  }

  if (!params.capabilityUrl) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
        <Alert>{t("cmc.missingRequestRef")}</Alert>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
        <p className="mb-4 text-sm text-muted">
          {offer?.requester?.username
            ? t("cmc.signinPromptFrom", { requester: `${offer.requester.username}@${offer.requester.host}` })
            : t("cmc.signinPrompt")}
        </p>
        <Link
          to={signInLinkFor("/cmc-accept", search)}
          className="inline-flex w-full items-center justify-center rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-95"
        >
          {t("cmc.signinContinue")}
        </Link>
      </Card>
    );
  }

  if (!params.scopeStreamId) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
        <Alert>{t("cmc.missingScope")}</Alert>
      </Card>
    );
  }

  async function approve() {
    if (!connection || !params.capabilityUrl || !params.scopeStreamId || !mayAnswer) return;
    setWorking("accept");
    setError(null);
    try {
      const res = await cmc.acceptInvite(connection, params.capabilityUrl, {
        scopeStreamId: params.scopeStreamId,
        accessName: params.accessName ?? undefined,
      });
      setDone("accepted");
      deliver({ ok: true, acceptEventId: res.acceptEventId });
    } catch (err: unknown) {
      const failure = inviteFailure(err, t("cmc.errorCouldNotApprove"), { username: signedInAs, canSwitchAccount: true });
      const { reason: _reason, ...shown } = failure;
      setError(shown);
      deliver({ ok: false, reason: failure.reason });
    } finally {
      setWorking(null);
    }
  }

  async function decline() {
    if (!connection || !params.capabilityUrl || !params.scopeStreamId || !mayAnswer) return;
    setWorking("refuse");
    setError(null);
    try {
      await cmc.refuseInvite(connection, params.capabilityUrl, {
        scopeStreamId: params.scopeStreamId,
      });
      setDone("refused");
      deliver({ ok: false, reason: "declined-by-user" });
    } catch (err: unknown) {
      const failure = inviteFailure(err, t("cmc.errorCouldNotDecline"), { username: signedInAs, canSwitchAccount: true });
      const { reason: _reason, ...shown } = failure;
      setError(shown);
      deliver({ ok: false, reason: failure.reason });
    } finally {
      setWorking(null);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          {done === "accepted" ? t("cmc.approvedTitle") : t("cmc.declinedTitle")}
        </h1>
        <Alert tone={done === "accepted" ? "success" : "danger"}>
          {done === "accepted"
            ? t("cmc.approvedBody")
            : t("cmc.declinedBody")}
        </Alert>
        <ReturnNotice outcome={returnOutcome} />
        <p className="text-sm text-muted">{t("cmc.closeWindow")}</p>
      </Card>
    );
  }

  // The platform refused this account as the one answering (it created the
  // invite): approving again would fail again, so the actions give way to
  // "Switch account" (the error above says why).
  const answerAsAnother = error?.switchAccount === true;

  const actionsBlocked = answerAsAnother ? (
    <div data-testid="cmc-switch-account">
      <Button type="button" onClick={switchAccount}>
        {t("cmc.switchAccount")}
      </Button>
    </div>
  ) : who.blocked ? (
    <ApprovingAccountBlocked who={who} />
  ) : undefined;

  return (
    <Card>
      <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
      <ReturnNotice outcome={returnOutcome} />
      <CmcOfferBlock
        offer={offer}
        loading={loadingOffer}
        error={error}
        labelFor={labelFor}
        busy={working}
        disabled={!offer || !mayAnswer}
        approveDisabled={emailState?.kind === "adding"}
        onApprove={() => void approve()}
        onDecline={() => void decline()}
        actionsBlocked={actionsBlocked}
        notice={
          <>
            {offer != null && emailState != null && (
              <MissingEmailNotice
                username={actingAs?.username ?? null}
                appName={offer.requester.username ? `${offer.requester.username}@${offer.requester.host}` : t("cmc.unidentifiedRequester")}
                state={emailState}
                onAdd={addEmail}
                disabled={working !== null}
              />
            )}
            {!answerAsAnother && <ApprovingAccountLine who={who} disabled={working !== null} />}
          </>
        }
      />
    </Card>
  );
}
