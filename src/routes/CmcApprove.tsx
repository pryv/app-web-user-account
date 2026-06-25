import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, Button, Alert } from "../components/ui";
import { useSession } from "../lib/session";

/**
 * Cross-account (CMC) approval.
 *
 * Reached from an app that holds NO personal token for the subject: that app
 * sends the subject here with a capability reference. The subject signs in (if
 * not already), reviews the request, and approves or declines — the requesting
 * app never holds the subject's token.
 *
 * The CMC capability model in the core is the back-channel/capability flow
 * (mint → accept → consume). Wiring the accept/decline call is pending the CMC
 * handoff spike, so the actions are presented but not yet submitted.
 */
export default function CmcApprove() {
  const { connection } = useSession();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const capability = params.get("capability") ?? params.get("requestId");
  const fromApp = params.get("fromName") ?? params.get("from") ?? "An application";
  const [error] = useState<string | null>(null);

  if (!capability) {
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
          Sign in to review and approve the request from <strong>{fromApp}</strong>.
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

  return (
    <Card>
      <h1 className="mb-2 text-2xl">Approve request</h1>
      <p className="mb-4 text-sm text-muted">
        <strong>{fromApp}</strong> is requesting your approval.
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 rounded bg-body p-3 text-xs break-all text-muted">
        Capability: {capability}
      </div>
      {/* TODO: render the decoded capability (what is being requested) and wire
          approve/decline to the CMC accept/consume API. */}
      <div className="flex gap-3">
        <Button type="button" disabled>Approve</Button>
        <button
          type="button"
          disabled
          className="inline-flex w-full items-center justify-center rounded border border-pryv-light-gray px-4 py-2 text-sm disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </Card>
  );
}
