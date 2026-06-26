import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as cmc from "@pryv/cmc";
import { Card, Button, Alert } from "../components/ui";
import { useSession } from "../lib/session";

interface ScopeUpdateParams {
  scopeRequestEventId: string | null;
  scopeStreamId: string | null;
  returnUrl: string | null;
  mode: "popup" | "redirect";
}

function parseParams(search: string): ScopeUpdateParams {
  const p = new URLSearchParams(search);
  const returnUrl = p.get("returnUrl");
  const mode = (p.get("mode") as "popup" | "redirect" | null) ?? (returnUrl ? "redirect" : "popup");
  return {
    scopeRequestEventId: p.get("scopeRequestEventId"),
    scopeStreamId: p.get("scopeStreamId"),
    returnUrl,
    mode,
  };
}

function deliverResult(
  res: { ok: boolean; updateEventId?: string; action?: "accept" | "refuse"; reason?: string },
  params: ScopeUpdateParams,
): void {
  if (params.mode === "redirect" && params.returnUrl) {
    const target = new URL(params.returnUrl);
    target.searchParams.set("cmcScopeUpdateResult", JSON.stringify(res));
    window.location.assign(target.toString());
    return;
  }
  if (window.opener) {
    window.opener.postMessage(
      { type: "cmc-scope-update-result", ...res },
      "*",
    );
    window.close();
  }
}

/**
 * Cross-account scope-update hand-off. The collector proposes a new permission
 * set via `proposeScopeUpdate`; the user (provider side) lands here to accept
 * or refuse, then the outcome is delivered back via the same popup-postMessage
 * / redirect-with-cmcScopeUpdateResult contract as the cmc-accept page.
 */
export default function CmcScopeUpdate() {
  const { connection } = useSession();
  const { search } = useLocation();
  const params = parseParams(search);
  const [working, setWorking] = useState<"accept" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);

  if (!params.scopeRequestEventId) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Approve scope update</h1>
        <Alert>This link is missing its scope-request reference.</Alert>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Approve scope update</h1>
        <p className="mb-4 text-sm text-muted">
          Sign in to review and approve this scope-update request.
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

  async function accept() {
    if (!connection || !params.scopeRequestEventId) return;
    setWorking("accept");
    setError(null);
    try {
      const res = (await cmc.acceptScopeUpdate(connection, params.scopeRequestEventId, {
        scopeStreamId: params.scopeStreamId ?? undefined,
      })) as { updateAcceptEventId: string };
      setDone("accepted");
      deliverResult(
        { ok: true, updateEventId: res.updateAcceptEventId, action: "accept" },
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

  async function refuse() {
    if (!connection || !params.scopeRequestEventId) return;
    setWorking("refuse");
    setError(null);
    try {
      const res = (await cmc.refuseScopeUpdate(connection, params.scopeRequestEventId, {
        scopeStreamId: params.scopeStreamId ?? undefined,
      })) as { updateRefuseEventId: string };
      setDone("refused");
      deliverResult(
        { ok: true, updateEventId: res.updateRefuseEventId, action: "refuse" },
        params,
      );
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
          {done === "accepted" ? "Scope update approved" : "Scope update declined"}
        </h1>
        <Alert tone={done === "accepted" ? "success" : "danger"}>
          {done === "accepted"
            ? "The new permission set has been granted."
            : "The scope-update request was declined."}
        </Alert>
        <p className="text-sm text-muted">You can close this window.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-2 text-2xl">Approve scope update</h1>
      <p className="mb-4 text-sm text-muted">
        The collector is requesting a change to the permissions you previously granted.
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 rounded bg-body p-3 text-xs break-all text-muted">
        Request id: {params.scopeRequestEventId}
      </div>
      <div className="flex gap-3">
        <Button type="button" disabled={working !== null} onClick={accept}>
          {working === "accept" ? "Approving…" : "Approve"}
        </Button>
        <button
          type="button"
          disabled={working !== null}
          onClick={refuse}
          className="inline-flex w-full items-center justify-center rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {working === "refuse" ? "Declining…" : "Decline"}
        </button>
      </div>
    </Card>
  );
}
