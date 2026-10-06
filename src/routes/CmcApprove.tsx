import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cmc } from "../lib/pryvClient";
import { Card, Alert, Button } from "../components/ui";
import { tNodes } from "../components/consent/tNodes";
import { useSession } from "../lib/useSession";
import { storedServiceInfoUrl } from "../lib/sessionStore";
import { CmcOfferBlock, type CmcOfferView } from "../components/consent/CmcOfferBlock";
import { httpUrlOrNull, trustedOpenerOrigin } from "../lib/safeRedirect";
import { signInLinkFor } from "../lib/handoffReturn";
import { inviteFailure, OFFER_UNREADABLE_KEY } from "../lib/cmcAccept";
import { loggableError, platformError } from "../lib/apiError";
import { hasUsableEmail, missingEmailErrorKey, readsAccountEmail } from "../lib/accountEmail";
import { maskUrlCredentials } from "../lib/maskCredentials";
import { MissingEmailNotice, type MissingEmailState } from "../components/consent/MissingEmailNotice";
import { useStreamLabels } from "../lib/useConsentDisplay";
import { isValidUsername } from "../lib/username";

/** Longest wait for the signed-in account's name before asking to sign in again (as `/auth`). */
const ACCOUNT_LOOKUP_WAIT_MS = 4000;

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
  /**
   * The account the calling app expects to answer (`username=`, lowercased),
   * or null. Only a value that can be a username counts: the page shows it, so
   * a crafted link cannot put arbitrary text there. An email (or any other
   * value) is not compared; it only pre-fills the sign-in form, like any
   * `username` hint.
   */
  expectedUsername: string | null;
}

function parseCmcParams(search: string): AcceptParams {
  const p = new URLSearchParams(search);
  const returnUrl = p.get("returnUrl");
  const mode = (p.get("mode") as "popup" | "redirect" | null) ?? (returnUrl ? "redirect" : "popup");
  // Lowered first: usernames are lowercase-only, and the rule rejects capitals.
  const hint = p.get("username")?.trim().toLowerCase() ?? "";
  return {
    capabilityUrl: p.get("capabilityUrl") ?? p.get("capability"),
    scopeStreamId: p.get("scopeStreamId"),
    accessName: p.get("accessName"),
    returnUrl,
    mode,
    expectedUsername: isValidUsername(hint) ? hint : null,
  };
}

/** The account the session acts on, as this page knows it. */
type ApprovingAccount = { status: "loading" } | { status: "known"; username: string } | { status: "unknown" };

const LINK_BUTTON =
  "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

/** A failed call's result row as an error carrying the platform's id (read by `platformError`). */
function rowError(error: { id?: string; message?: string }, fallback: string): Error {
  return Object.assign(new Error(error.message ?? fallback), { id: error.id });
}

function deliverResult(res: AcceptOutcome, params: AcceptParams): void {
  const payload = outcomePayload(res);
  if (params.mode === "redirect" && params.returnUrl) {
    // Only navigate back to an absolute http(s) returnUrl: a `javascript:`
    // or `data:` value would execute in this trusted origin.
    const target = httpUrlOrNull(params.returnUrl);
    if (!target) return;
    target.searchParams.set("cmcAcceptResult", JSON.stringify(payload));
    window.location.assign(target.toString());
    return;
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
  const { connection, setConnection, actingAs } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = parseCmcParams(search);

  const [offer, setOffer] = useState<CmcOfferView | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [error, setError] = useState<{ message: string; tone: "danger" | "info" } | null>(null);
  const [working, setWorking] = useState<"accept" | "refuse" | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);
  const labelFor = useStreamLabels(storedServiceInfoUrl());

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
  const [account, setAccount] = useState<ApprovingAccount>({ status: "loading" });
  useEffect(() => {
    setAccount({ status: "loading" });
    if (!connection) return;
    let cancelled = false;
    // The lookup is a network call: a stalled one must not leave the actions
    // disabled with no way out. Past the wait, ask to sign in again; a name
    // arriving later is ignored (the page does not change under the user).
    const giveUp = setTimeout(() => {
      console.warn("cmc-accept: the signed-in account could not be read in time");
      cancelled = true;
      setAccount({ status: "unknown" });
    }, ACCOUNT_LOOKUP_WAIT_MS);
    connection
      .username()
      .then((username) => {
        if (!cancelled) setAccount({ status: "known", username });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("cmc-accept: could not read the signed-in account:", loggableError(err));
        setAccount({ status: "unknown" });
      })
      .finally(() => clearTimeout(giveUp));
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
    // The session's account (its endpoint) decides; the object identity does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountEndpoint]);

  const signedInAs = account.status === "known" ? account.username : null;
  const wrongAccount =
    signedInAs != null &&
    params.expectedUsername != null &&
    params.expectedUsername !== signedInAs.toLowerCase();
  /** Approve / Decline answer with the session: only once it is known to be the right account. */
  const mayAnswer = signedInAs != null && !wrongAccount;

  /** Sign out, sign in (as someone else), and come back to this same request. */
  function switchAccount() {
    const query = new URLSearchParams(search);
    // Signing out forgets the session's platform: keep it on the way back.
    const platform = storedServiceInfoUrl();
    if (!query.has("pryvServiceInfoUrl") && platform) query.set("pryvServiceInfoUrl", platform);
    // Navigate first, then drop the session: /signin then opens on its form.
    navigate(signInLinkFor("/cmc-accept", "?" + query.toString()));
    setConnection(null);
  }

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
      deliverResult({ ok: true, acceptEventId: res.acceptEventId }, params);
    } catch (err: unknown) {
      const failure = inviteFailure(err, t("cmc.errorCouldNotApprove"));
      setError({ message: failure.message, tone: failure.tone });
      deliverResult({ ok: false, reason: failure.reason }, params);
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
      deliverResult({ ok: false, reason: "declined-by-user" }, params);
    } catch (err: unknown) {
      const failure = inviteFailure(err, t("cmc.errorCouldNotDecline"));
      setError({ message: failure.message, tone: failure.tone });
      deliverResult({ ok: false, reason: failure.reason }, params);
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
        <p className="text-sm text-muted">{t("cmc.closeWindow")}</p>
      </Card>
    );
  }

  // Who answers, said right above the actions (while it is looked up, why they
  // are disabled). Without a known account (or with another one than the app
  // expects), the actions are replaced by a way to sign in as the right person.
  const accountLine =
    account.status === "loading" ? (
      <p className="mb-4 text-sm text-muted" data-testid="cmc-checking-account">
        {t("cmc.checkingAccount")}
      </p>
    ) : mayAnswer ? (
      <p className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm" data-testid="cmc-approving-as">
        <span>{tNodes("cmc.approvingAs", { username: <strong>{signedInAs}</strong> })}</span>
        <button type="button" onClick={switchAccount} disabled={working !== null} className={LINK_BUTTON}>
          {t("cmc.notYouSwitch")}
        </button>
      </p>
    ) : null;

  const actionsBlocked =
    account.status === "unknown" || wrongAccount ? (
      <div data-testid="cmc-switch-account">
        <Alert tone="info">
          {wrongAccount
            ? tNodes("cmc.expectedOtherAccount", {
                expected: <strong>{params.expectedUsername}</strong>,
                username: <strong>{signedInAs}</strong>,
              })
            : t("cmc.accountUnconfirmed")}
        </Alert>
        <Button type="button" onClick={switchAccount}>
          {t("cmc.switchAccount")}
        </Button>
      </div>
    ) : undefined;

  return (
    <Card>
      <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
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
            {accountLine}
          </>
        }
      />
    </Card>
  );
}
