import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Link, useLocation } from "react-router-dom";
import { cmc } from "../lib/pryvClient";
import { Card, Alert } from "../components/ui";
import { useSession, storedServiceInfoUrl } from "../lib/session";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import { consentEntries, type OfferPermission } from "../lib/consent";
import { httpUrlOrNull, trustedOpenerOrigin } from "../lib/safeRedirect";
import { isTrustedResultOrigin } from "../lib/oauth2Flow";
import { trustedApiOrigins } from "../lib/trustedOrigins";
import { signInLinkFor } from "../lib/handoffReturn";
import { inviteFailure, OFFER_UNREADABLE_KEY } from "../lib/cmcAccept";
import { useStreamLabels } from "../lib/useConsentDisplay";

/** Strip the token-bearing field, leaving only the non-sensitive outcome. */
function outcomeOnly(res: { ok: boolean; acceptEventId?: string; reason?: string }) {
  return { ok: res.ok, acceptEventId: res.acceptEventId, reason: res.reason };
}

interface OfferView {
  requester: { username: string | null; host: string; displayName?: string };
  requestedPermissions: OfferPermission[];
  consent?: Record<string, string>;
  mode: string;
  features?: { chat?: boolean; systemMessaging?: boolean };
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

function deliverResult(
  res: { ok: boolean; dataGrantApiEndpoint?: string; acceptEventId?: string; reason?: string },
  params: AcceptParams,
): void {
  // `res` carries `dataGrantApiEndpoint`, a token-bearing (`https://<token>@…`)
  // endpoint. `returnUrl` / the opener are caller-supplied and MUST NOT be
  // trusted as the token's destination: the token leaves only for an operator-
  // allowlisted origin (prod fails closed with no allowlist). Otherwise deliver
  // the outcome only — the peer app can still read the endpoint from its
  // authenticated CMC inbox. The trust decision is independent of how the
  // target origin is chosen, so a crafted `returnUrl` can never harvest it.
  const selfOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
  const trustOpts = {
    // Origins trusted to receive the token-bearing `dataGrantApiEndpoint`:
    // the same operator allowlist as the OAuth `pryvApi` check.
    trustedOrigins: trustedApiOrigins(),
    selfOrigin,
    requireAllowlist: import.meta.env.PROD,
  };

  if (params.mode === "redirect" && params.returnUrl) {
    // Only navigate back to an absolute http(s) returnUrl — a `javascript:`
    // or `data:` value would execute in this trusted origin.
    const target = httpUrlOrNull(params.returnUrl);
    if (!target) return;
    const payload = isTrustedResultOrigin(target.origin, trustOpts) ? res : outcomeOnly(res);
    target.searchParams.set("cmcAcceptResult", JSON.stringify(payload));
    window.location.assign(target.toString());
    return;
  }
  if (window.opener) {
    // Pin to the REAL opener (referrer) first; `returnUrl` is only a fallback
    // pin hint, never the trust anchor for the token.
    const pinOrigin = trustedOpenerOrigin(params.returnUrl, document.referrer);
    const payload =
      pinOrigin && isTrustedResultOrigin(pinOrigin, trustOpts) ? res : outcomeOnly(res);
    // Never broadcast the token: if no origin can be derived, only the
    // (non-sensitive) outcome may go to '*'.
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
 * the accept trigger), so every entry renders locked. Unlike the OAuth
 * consent (always fresh sign-in), this surface reuses the persisted account
 * session — the capability hand-off already binds the request to a specific
 * subject, and the in-app approval UX relies on the session.
 */
export default function CmcApprove() {
  const { t } = useTranslation();
  const { connection } = useSession();
  const { search } = useLocation();
  const params = parseCmcParams(search);

  const [offer, setOffer] = useState<OfferView | null>(null);
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
      .then((o: unknown) => setOffer(o as OfferView))
      .catch((err: unknown) => {
        console.warn("cmc-accept: could not read the offer", err);
        setError({ message: i18n.t(OFFER_UNREADABLE_KEY), tone: "danger" });
      })
      .finally(() => setLoadingOffer(false));
  }, [params.capabilityUrl]);

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
    if (!connection || !params.capabilityUrl || !params.scopeStreamId) return;
    setWorking("accept");
    setError(null);
    try {
      const res = (await cmc.acceptInvite(connection, params.capabilityUrl, {
        scopeStreamId: params.scopeStreamId,
        accessName: params.accessName ?? undefined,
      })) as { acceptEventId: string; dataGrantApiEndpoint?: string };
      setDone("accepted");
      deliverResult(
        {
          ok: true,
          acceptEventId: res.acceptEventId,
          dataGrantApiEndpoint: res.dataGrantApiEndpoint,
        },
        params,
      );
    } catch (err: unknown) {
      const failure = inviteFailure(err, t("cmc.errorCouldNotApprove"));
      setError({ message: failure.message, tone: failure.tone });
      deliverResult({ ok: false, reason: failure.reason }, params);
    } finally {
      setWorking(null);
    }
  }

  async function decline() {
    if (!connection || !params.capabilityUrl || !params.scopeStreamId) return;
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

  return (
    <Card>
      <h1 className="mb-2 text-2xl">{t("cmc.approveTitle")}</h1>
      {loadingOffer && <p className="mb-4 text-sm text-muted">{t("cmc.loadingOffer")}</p>}
      {error && <Alert tone={error.tone}>{error.message}</Alert>}
      {offer && (
        <>
          <p className="mb-4 text-sm">
            {/* The account comes from the capability itself (verified); the
                display name is what the requester says about itself, so it is
                shown as such and never in place of the account. */}
            <strong data-testid="cmc-requester">
              {offer.requester.username
                ? `${offer.requester.username}@${offer.requester.host}`
                : t("cmc.unidentifiedRequester")}
            </strong>
            {offer.requester.displayName && (
              <span className="text-muted"> {t("cmc.callsItself", { name: offer.requester.displayName })}</span>
            )}{" "}
            {t("cmc.requestingAccess")}
          </p>
          {offer.consent && Object.values(offer.consent)[0] && (
            <p className="mb-4 text-sm text-muted">{Object.values(offer.consent)[0]}</p>
          )}
          <PermissionList entries={consentEntries(offer.requestedPermissions, { labelFor })} />
        </>
      )}
      <ConsentActions
        busy={working}
        disabled={!offer}
        acceptLabel={t("cmc.approve")}
        refuseLabel={t("cmc.decline")}
        onAccept={() => void approve()}
        onRefuse={() => void decline()}
      />
    </Card>
  );
}
