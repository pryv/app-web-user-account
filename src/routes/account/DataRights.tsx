import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, Field, Alert } from "../../components/ui";
import { Trash2, Download } from "lucide-react";
import { useSession, signinPath, storedServiceInfoUrl } from "../../lib/session";
import { parseAuthParams } from "../../lib/authParams";

/**
 * Data rights (GDPR / Art.17).
 *
 * Account delete: wired to `DELETE {apiEndpoint}users/{username}` (the
 * public `auth.delete` route). Requires the subject to re-confirm the
 * destructive action by typing their username.
 *
 * Export: hands off to `pryv-account-backup-webapp` (operator-hostable
 * sample that consumes the browser-isomorphic `@pryv/account-backup`
 * fetchers and streams ZIPs). We link out rather than embed the library —
 * `@pryv/account-backup` is git-clone-only, so vendoring it would force
 * every operator fork to carry an extra repo. No token crosses the URL;
 * the subject authenticates in the backup app. Operators point at their own
 * deploy via `VITE_BACKUP_WEBAPP_URL`.
 */
const BACKUP_WEBAPP_URL =
  import.meta.env.VITE_BACKUP_WEBAPP_URL ||
  "https://pryv.github.io/pryv-account-backup-webapp/";

export default function DataRights() {
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [username, setUsername] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    connection.username().then(setUsername).catch(() => setUsername(null));
  }, [connection]);

  const matched = !!username && confirm === username;

  // Build the backup hand-off URL: pre-fill the platform + offer a back link.
  // No token — the subject signs in at the backup app.
  function exportUrl(): string {
    const svc = parseAuthParams(search).serviceInfoUrl ?? storedServiceInfoUrl();
    const u = new URL(BACKUP_WEBAPP_URL);
    if (svc) u.searchParams.set("pryvServiceInfoUrl", svc);
    u.searchParams.set("backUrl", window.location.href);
    u.searchParams.set("backLabel", "Account");
    return u.toString();
  }

  async function deleteAccount() {
    if (!connection || !username) return;
    setDeleting(true);
    setError(null);
    try {
      const c = connection as unknown as { endpoint: string; token: string };
      const res = await fetch(c.endpoint + "users/" + encodeURIComponent(username), {
        method: "DELETE",
        headers: { Authorization: c.token },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error("Delete failed (" + res.status + "): " + body.slice(0, 200));
      }
      // Server confirmed deletion — wipe local session and bounce home.
      // Navigate FIRST — see AccountLayout signOut for the same race fix.
      const target = signinPath();
      navigate(target, { replace: true });
      setConnection(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete account.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-4">
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Export your data
        </div>
        <p className="mb-3 text-sm text-muted">
          Download a portable copy of all the data in your account, as a series
          of ZIP files. This opens the account-backup app, where you sign in and
          run the export.
        </p>
        <a
          href={exportUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Download size={14} aria-hidden />
          Start export
        </a>
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-danger">
          Delete account
        </div>
        <p className="mb-3 text-sm text-muted">
          Permanently delete your account and all of its data. This cannot be undone.
        </p>
        {error && <Alert>{error}</Alert>}
        <p className="mb-2 text-sm">
          Type <strong>{username ?? "your username"}</strong> below to confirm.
        </p>
        <Field
          id="confirm-username"
          label="Confirm username"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button
          type="button"
          onClick={deleteAccount}
          disabled={!matched || deleting}
          className="inline-flex items-center gap-2 rounded border border-danger px-4 py-2 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
        >
          <Trash2 size={14} aria-hidden />
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </Card>
    </section>
  );
}
