import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as cmc from "@pryv/cmc";
import { Card, Button, Alert } from "../components/ui";
import { useSession } from "../lib/session";
// Shared permission-label vocabulary (full lexicon: stream AND feature
// permissions) — one render implementation across consent surfaces.
import { permissionLabel, type OfferPermission } from "../lib/oauth2Flow";

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
  if (params.mode === "redirect" && params.returnUrl) {
    const target = new URL(params.returnUrl);
    target.searchParams.set("cmcAcceptResult", JSON.stringify(res));
    window.location.assign(target.toString());
    return;
  }
  if (window.opener) {
    window.opener.postMessage(
      { type: "cmc-accept-result", ...res },
      "*",
    );
    window.close();
  }
}

/**
 * Cross-account approval. Reads the capability offer, lets the subject Approve
 * or Decline, and reports the outcome back via the @pryv/cmc hand-off contract
 * (popup postMessage / redirect with `?cmcAcceptResult=<json>`).
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
          <ul className="mb-4 space-y-1 text-sm">
            {offer.requestedPermissions.map((p, i) => (
              <li key={i} className="rounded bg-body px-3 py-2 break-all">
                {permissionLabel(p)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex gap-3">
        <Button type="button" disabled={!offer || working !== null} onClick={approve}>
          {working === "accept" ? "Approving…" : "Approve"}
        </Button>
        <button
          type="button"
          disabled={!offer || working !== null}
          onClick={decline}
          className="inline-flex w-full items-center justify-center rounded border border-divider px-4 py-2 text-sm hover:bg-body disabled:opacity-50"
        >
          {working === "refuse" ? "Declining…" : "Decline"}
        </button>
      </div>
    </Card>
  );
}
