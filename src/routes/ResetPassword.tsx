import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService, resolveUserId } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";

/**
 * Two modes:
 * - no `resetToken` in the URL → request a reset (`Service.requestPasswordReset`);
 * - with `resetToken` → set a new password (`Service.resetPassword`).
 */
export default function ResetPassword() {
  const { search } = useLocation();
  const resetToken = new URLSearchParams(search).get("resetToken");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { appId } = parseAuthParams(search);
      const service = getService(search);
      const userId = await resolveUserId(service, username);
      if (resetToken) {
        await service.resetPassword(userId, newPassword, resetToken, appId);
      } else {
        await service.requestPasswordReset(userId, appId);
      }
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{resetToken ? "Password updated" : "Check your email"}</h1>
        <Alert tone="success">
          {resetToken
            ? "Your password has been changed."
            : "If the account exists, a reset link has been sent."}
        </Alert>
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{resetToken ? "Set a new password" : "Reset password"}</h1>
      <p className="mb-6 text-sm text-muted">
        {resetToken
          ? "Choose a new password for your account."
          : "We'll email you a link to reset your password."}
      </p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Field id="username" label="Username or email" autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value)} required />
        {resetToken && (
          <Field id="newPassword" label="New password" type="password" autoComplete="new-password"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting…" : resetToken ? "Update password" : "Send reset link"}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}
