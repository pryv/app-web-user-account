import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService, resolveUserId } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";

/**
 * Two modes:
 * - no `resetToken` in the URL → request a reset (`Service.requestPasswordReset`);
 * - with `resetToken` → set a new password (`Service.resetPassword`).
 */
export default function ResetPassword() {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t("reset.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{resetToken ? t("reset.updatedTitle") : t("reset.checkEmailTitle")}</h1>
        <Alert tone="success">
          {resetToken
            ? t("reset.passwordChangedBody")
            : t("reset.linkSentBody")}
        </Alert>
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          {t("reset.backToSignIn")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{resetToken ? t("reset.setTitle") : t("reset.requestTitle")}</h1>
      <p className="mb-6 text-sm text-muted">
        {resetToken
          ? t("reset.setSubtitle")
          : t("reset.requestSubtitle")}
      </p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Field id="username" label={t("signin.usernameLabel")} autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value)} required />
        {resetToken && (
          <Field id="newPassword" label={t("password.newLabel")} type="password" autoComplete="new-password"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        )}
        <Button type="submit" disabled={busy}>
          {busy ? t("reset.submitting") : resetToken ? t("reset.updateButton") : t("reset.sendButton")}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to={`/signin${search}`} className="text-primary hover:underline">
          {t("reset.backToSignIn")}
        </Link>
      </div>
    </Card>
  );
}
