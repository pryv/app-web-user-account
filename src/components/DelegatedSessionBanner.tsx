import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";

/** The `delegation` field of `access-info` for an access acting on a controlled account. */
interface AccessInfoDelegation {
  isDelegatedAccess?: boolean;
  controlledUsername?: string;
  delegate?: { username?: string };
}

function delegationOf(info: unknown): AccessInfoDelegation | null {
  const d = (info as { delegation?: AccessInfoDelegation } | null)?.delegation;
  return d?.isDelegatedAccess === true ? d : null;
}

/**
 * Reminder that the session acts for another account, on every page.
 *
 * A delegate session is as powerful as the account owner's, so the reminder
 * must not depend on which page is open or on this browser's own record of how
 * the session started: the server's `access-info` is read first, and the local
 * session stack (which also provides "Back to ...") second. Without a stack
 * (another tab cleared it, or the session was opened elsewhere) the reminder
 * still shows, just without the way back.
 */
export default function DelegatedSessionBanner() {
  const { connection, actingAs, backToParent } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [server, setServer] = useState<AccessInfoDelegation | null>(null);

  useEffect(() => {
    setServer(null);
    if (!connection) return;
    let cancelled = false;
    connection
      .accessInfo()
      .then((info) => {
        if (!cancelled) setServer(delegationOf(info));
      })
      .catch(() => {
        // No server signal; the local stack alone decides.
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  if (!connection) return null;
  const controlled = server?.controlledUsername ?? actingAs?.username;
  const delegate = server?.delegate?.username ?? actingAs?.parentUsername;
  if (!server && !actingAs) return null;

  return (
    <div
      role="status"
      data-testid="delegated-session-banner"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-warning bg-warning px-4 py-2 text-sm text-pryv-black"
    >
      <span>
        Acting as <strong>{controlled ?? "another account"}</strong>
        {delegate ? (
          <>
            {" "}via <strong>{delegate}</strong>
          </>
        ) : null}
        .
      </span>
      {actingAs && (
        <button
          type="button"
          onClick={() => {
            backToParent();
            navigate("/account/delegation" + search);
          }}
          className="rounded px-2 py-1 font-medium underline hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Back to {actingAs.parentUsername}
        </button>
      )}
    </div>
  );
}
