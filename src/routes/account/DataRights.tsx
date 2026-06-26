import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useSession, signinPath } from "../../lib/session";

/**
 * Data rights (GDPR / Art.17).
 *
 * Account delete: wired to `DELETE {apiEndpoint}users/{username}` (the
 * public `auth.delete` route). Requires the subject to re-confirm the
 * destructive action by typing their username.
 *
 * Export: structured stub — the eventual integration is the
 * `@pryv/account-backup` library (browser-isomorphic), but it isn't
 * published on npm yet, so wiring it as a runtime dep would require
 * a git URL operators wouldn't expect on this public app. The button is
 * disabled with a status line until that ships.
 */
export default function DataRights() {
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    connection.username().then(setUsername).catch(() => setUsername(null));
  }, [connection]);

  const matched = !!username && confirm === username;

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
          Download a copy of all the data in your account.
        </p>
        <Button type="button" disabled>
          Start export
        </Button>
        <p className="mt-2 text-xs text-muted">
          Browser-side export is pending the @pryv/account-backup release.
        </p>
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
          className="rounded border border-danger px-4 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </Card>
    </section>
  );
}
