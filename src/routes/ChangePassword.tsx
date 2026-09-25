import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../components/ui";
import { useSession, signinPath } from "../lib/session";

/**
 * Subject-side password change. Calls `account.changePassword` on the user's
 * own Connection (a personal access is required). Bounces to /signin if there
 * is no active session — change-password is never anonymous.
 */
export default function ChangePassword() {
  const { t } = useTranslation();
  const { connection } = useSession();
  const { pathname, search } = useLocation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!connection) return <Navigate to={signinPath(search, pathname + search)} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError(t("changepassword.mismatch"));
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
      setError(err instanceof Error ? err.message : t("changepassword.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">{t("changepassword.successTitle")}</h1>
        <Alert tone="success">{t("changepassword.successBody")}</Alert>
        <Link to="/account" className="text-sm text-primary hover:underline">
          {t("changepassword.backToAccount")}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{t("changepassword.title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("changepassword.subtitle")}</p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="old-password"
          label={t("changepassword.currentPasswordLabel")}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
        />
        <Field
          id="new-password"
          label={t("changepassword.newPasswordLabel")}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <Field
          id="confirm-password"
          label={t("changepassword.newPasswordConfirmationLabel")}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? t("changepassword.updatingButton") : t("changepassword.updateButton")}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Link to="/account" className="text-primary hover:underline">
          {t("changepassword.backToAccount")}
        </Link>
      </div>
    </Card>
  );
}
