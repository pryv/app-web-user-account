import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as cmc from "@pryv/cmc";
import { Card, Alert } from "../components/ui";
import { useSession } from "../lib/session";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import { consentEntries, type OfferPermission } from "../lib/consent";
import { httpUrlOrNull, trustedOpenerOrigin } from "../lib/safeRedirect";
import { isTrustedResultOrigin } from "../lib/oauth2Flow";

/** Operator allowlist of origins trusted to receive the token-bearing
 * `dataGrantApiEndpoint` — same control as the OAuth `pryvApi` allowlist. */
const TRUSTED_RESULT_ORIGINS = (import.meta.env.VITE_OAUTH_TRUSTED_API_ORIGINS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

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
    trustedOrigins: TRUSTED_RESULT_ORIGINS,
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
  const { connection } = useSession();
  const { search } = useLocation();
  const params = parseCmcParams(search);

  const [offer, setOffer] = useState<OfferView | null>(null);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"accept" | "refuse" | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);

  // Always try to read the offer (anonymous read via the capability access).
  useEffect(() => {
    if (!params.capabilityUrl) return;
    setLoadingOffer(true);
    cmc
      .readOffer(params.capabilityUrl)
      .then((o: unknown) => setOffer(o as OfferView))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not read the offer."),
      )
      .finally(() => setLoadingOffer(false));
  }, [params.capabilityUrl]);

  if (!params.capabilityUrl) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Approve request</h1>
        <Alert>This approval link is missing its request reference.</Alert>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Approve request</h1>
        <p className="mb-4 text-sm text-muted">
          Sign in to review and approve this request{offer?.requester?.displayName ? ` from ${offer.requester.displayName}` : ""}.
        </p>
        <Link
          to={`/signin${search}`}
          className="inline-flex w-full items-center justify-center rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-95"
        >
          Sign in to continue
        </Link>
      </Card>
    );
  }

  if (!params.scopeStreamId) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Approve request</h1>
        <Alert>This approval link is missing the destination scope (scopeStreamId).</Alert>
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
      const msg = err instanceof Error ? err.message : "Could not approve.";
      setError(msg);
      deliverResult({ ok: false, reason: msg }, params);
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
      const msg = err instanceof Error ? err.message : "Could not decline.";
      setError(msg);
      deliverResult({ ok: false, reason: msg }, params);
    } finally {
      setWorking(null);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          {done === "accepted" ? "Request approved" : "Request declined"}
        </h1>
        <Alert tone={done === "accepted" ? "success" : "danger"}>
          {done === "accepted"
            ? "The requesting app has been granted the access you approved."
            : "The request was declined."}
        </Alert>
        <p className="text-sm text-muted">You can close this window.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-2xl">Approve request</h1>
      {loadingOffer && <p className="mb-4 text-sm text-muted">Loading offer…</p>}
      {error && <Alert>{error}</Alert>}
      {offer && (
        <>
          <p className="mb-4 text-sm">
            <strong>
              {offer.requester.displayName ??
                (offer.requester.username
                  ? `${offer.requester.username}@${offer.requester.host}`
                  : "An application")}
            </strong>{" "}
            is requesting access:
          </p>
          {offer.consent && Object.values(offer.consent)[0] && (
            <p className="mb-4 text-sm text-muted">{Object.values(offer.consent)[0]}</p>
          )}
          <PermissionList entries={consentEntries(offer.requestedPermissions)} />
        </>
      )}
      <ConsentActions
        busy={working}
        disabled={!offer}
        acceptLabel="Approve"
        refuseLabel="Decline"
        onAccept={() => void approve()}
        onRefuse={() => void decline()}
      />
    </Card>
  );
}
