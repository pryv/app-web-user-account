import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cmc } from "../lib/pryvClient";
import { Card, Alert } from "../components/ui";
import { useSession, storedServiceInfoUrl } from "../lib/session";
import { useStreamLabels } from "../lib/useConsentDisplay";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import { consentEntries, pickText, type LocalizableText, type OfferPermission } from "../lib/consent";
import { httpUrlOrNull, trustedOpenerOrigin } from "../lib/safeRedirect";
import { answeredRequestMessage, scopeUpdateFailure, scopeUpdateSuccessNote } from "../lib/scopeUpdate";
import { signInLinkFor } from "../lib/handoffReturn";

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
  res: {
    ok: boolean;
    updateEventId?: string;
    action?: "accept" | "refuse";
    reason?: string;
    peerNotified?: boolean;
  },
  params: ScopeUpdateParams,
): void {
  if (params.mode === "redirect" && params.returnUrl) {
    // Only navigate back to an absolute http(s) returnUrl — a `javascript:`
    // or `data:` value would execute in this trusted origin.
    const target = httpUrlOrNull(params.returnUrl);
    if (!target) return;
    target.searchParams.set("cmcScopeUpdateResult", JSON.stringify(res));
    window.location.assign(target.toString());
    return;
  }
  if (window.opener) {
    // This payload carries no token, but still pin the postMessage to the
    // opener's origin when one can be derived rather than broadcasting to any
    // listener; fall back to `'*'` only when no trustworthy origin is known.
    const targetOrigin = trustedOpenerOrigin(params.returnUrl, document.referrer);
    window.opener.postMessage(
      { type: "cmc-scope-update-result", ...res },
      targetOrigin ?? "*",
    );
    window.close();
  }
}

/**
 * Cross-account scope-update hand-off. The collector proposes a new permission
 * set via `proposeScopeUpdate`; the user (provider side) lands here to accept
 * or refuse, then the outcome is delivered back via the same popup-postMessage
 * / redirect-with-cmcScopeUpdateResult contract as the cmc-accept page.
 *
 * The scope-request event lives on the user's own account (collector
 * stream), so the proposed `newPermissions` are read with the session and
 * rendered with the shared consent kit before the user decides.
 */
export default function CmcScopeUpdate() {
  const { connection } = useSession();
  const labelFor = useStreamLabels(storedServiceInfoUrl());
  const { search } = useLocation();
  const params = parseParams(search);
  const [proposal, setProposal] = useState<{
    newPermissions: OfferPermission[];
    message: string | null;
    /** Set when the request was already answered: nothing left to decide. */
    answered: string | null;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<"accept" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);

  // Load the scope-request event to show WHAT the collector proposes —
  // the user should never approve an unseen permission set.
  useEffect(() => {
    if (!connection || !params.scopeRequestEventId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [res] = (await connection.api([
          { method: "events.getOne", params: { id: params.scopeRequestEventId } },
        ])) as Array<{
          event?: { content?: { newPermissions?: OfferPermission[]; message?: unknown; status?: unknown } };
          error?: { id?: string; message: string };
        }>;
        if (cancelled) return;
        if (res?.error) throw Object.assign(new Error(res.error.message), { id: res.error.id });
        const content = res?.event?.content;
        if (!content || !Array.isArray(content.newPermissions)) {
          throw new Error("The scope-update request carries no permission set.");
        }
        // `message` may be a plain string or a localized text map.
        const message =
          typeof content.message === "string"
            ? content.message
            : content.message != null && typeof content.message === "object"
              ? pickText(content.message as LocalizableText)
              : "";
        setProposal({
          newPermissions: content.newPermissions,
          message: message || null,
          answered: answeredRequestMessage(content.status),
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(scopeUpdateFailure(err, "Could not load the scope-update request.").message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, params.scopeRequestEventId]);

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
          to={signInLinkFor("/cmc-scope-update", search)}
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
      // Resolves only once the platform applied the new permission set;
      // throws when nothing changed.
      const res = (await cmc.acceptScopeUpdate(connection, params.scopeRequestEventId, {
        scopeStreamId: params.scopeStreamId ?? undefined,
      })) as { updateAcceptEventId: string; peerNotified?: boolean };
      setDoneNote(scopeUpdateSuccessNote(res));
      setDone("accepted");
      deliverResult(
        { ok: true, updateEventId: res.updateAcceptEventId, action: "accept", peerNotified: res.peerNotified },
        params,
      );
    } catch (err: unknown) {
      const failure = scopeUpdateFailure(err, "Could not approve.");
      setError(failure.message);
      deliverResult({ ok: false, reason: failure.reason }, params);
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
      })) as { updateRefuseEventId: string; peerNotified?: boolean };
      setDoneNote(scopeUpdateSuccessNote(res));
      setDone("refused");
      deliverResult(
        { ok: true, updateEventId: res.updateRefuseEventId, action: "refuse", peerNotified: res.peerNotified },
        params,
      );
    } catch (err: unknown) {
      const failure = scopeUpdateFailure(err, "Could not decline.");
      setError(failure.message);
      deliverResult({ ok: false, reason: failure.reason }, params);
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
        {doneNote && <p className="mb-2 text-sm text-muted">{doneNote}</p>}
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
      {loadError && <Alert>{loadError}</Alert>}
      {proposal?.answered && <Alert>{proposal.answered}</Alert>}
      {error && <Alert>{error}</Alert>}
      {proposal && (
        <>
          {proposal.message && <p className="mb-4 text-sm text-muted">{proposal.message}</p>}
          <p className="mb-2 text-sm">Proposed permissions:</p>
          <PermissionList entries={consentEntries(proposal.newPermissions, { labelFor })} />
        </>
      )}
      {!proposal && !loadError && (
        <p className="mb-4 text-sm text-muted">Loading the proposed permissions…</p>
      )}
      <div className="mb-4 rounded bg-body p-3 text-xs break-all text-muted">
        Request id: {params.scopeRequestEventId}
      </div>
      <ConsentActions
        busy={working}
        disabled={!proposal || proposal.answered != null}
        acceptLabel="Approve"
        refuseLabel="Decline"
        onAccept={() => void accept()}
        onRefuse={() => void refuse()}
      />
    </Card>
  );
}
