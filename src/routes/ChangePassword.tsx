import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { useSession, signinPath } from "../lib/session";

/**
 * Subject-side password change. Calls `account.changePassword` on the user's
 * own Connection (a personal access is required). Bounces to /signin if there
 * is no active session — change-password is never anonymous.
 */
export default function ChangePassword() {
  const { connection } = useSession();
  const { search } = useLocation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!connection) return <Navigate to={signinPath(search)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const [res] = (await connection!.api([
        {
          method: "account.changePassword",
          params: { oldPassword, newPassword },
        },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setDone(true);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">Password updated</h1>
        <Alert tone="success">Your password has been changed.</Alert>
        <Link to="/account" className="text-sm text-primary hover:underline">
          Back to your account
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Change password</h1>
      <p className="mb-6 text-sm text-muted">Set a new password for your account.</p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="old-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
        />
        <Field
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <Field
          id="confirm-password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to="/account" className="text-primary hover:underline">
          Back to your account
        </Link>
      </div>
    </Card>
  );
}
