import { useEffect, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useConfirm } from "../../components/ConfirmDialog";
import { useSession } from "../../lib/useSession";
import { connectionFor, storedServiceInfoUrl } from "../../lib/sessionStore";
import { isValidUsername, normalizeUsernameInput, usernameRules } from "../../lib/username";
import {
  changeUsername,
  endpointForUsername,
  getUsernameChanges,
  UsernameChangeError,
  type UsernameChangeRefusal,
  type UsernameChanges,
  type UsernameChangeWarning,
} from "../../lib/usernameChange";

/**
 * The account's username, and changing it (`account.changeUsername`) when the
 * platform offers changes and some are left. Not offered while acting for
 * another account, nor in a delegate's session. After a change the session moves to the endpoint of the
 * new name; the former name keeps routing to the account, so the apps
 * already connected keep working.
 */
export default function UsernameCard({
  username,
  onChanged,
}: {
  username: string | undefined;
  onChanged: (username: string) => void;
}) {
  const { t } = useTranslation();
  const { connection, actingAs, setConnection } = useSession();
  const [confirm, dialog] = useConfirm();
  const [changes, setChanges] = useState<UsernameChanges | null>(null);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<UsernameChangeWarning[]>([]);
  const acting = actingAs != null;

  useEffect(() => {
    let cancelled = false;
    setChanges(null);
    if (!connection || acting) return;
    void (async () => {
      // A delegate's session (the core says so in its access info) does not
      // rename the account it acts for, like a session opened with "act as".
      let delegated = false;
      try {
        const info = (await connection.accessInfo()) as { delegation?: { isDelegatedAccess?: boolean } } | null;
        delegated = info?.delegation?.isDelegatedAccess === true;
      } catch {
        delegated = false;
      }
      if (delegated || cancelled) return;
      const c = await getUsernameChanges(connection);
      if (!cancelled) setChanges(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, acting]);

  function refusalMessage(refusal: UsernameChangeRefusal, serverMessage: string): string {
    switch (refusal) {
      case "taken":
        return t("profile.usernameChange.errTaken");
      case "reserved":
        return t("profile.usernameChange.errReserved");
      case "limit":
        return t("profile.usernameChange.errLimit");
      case "same":
        return t("profile.usernameChange.errSame");
      case "format":
        return t("profile.usernameChange.errFormat");
      case "personal":
        return t("profile.usernameChange.errPersonal");
      default:
        return serverMessage || t("profile.usernameChange.errFailed");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!connection || !username) return;
    setError(null);
    const wanted = normalizeUsernameInput(newUsername);
    if (wanted === username) {
      setError(t("profile.usernameChange.errSame"));
      return;
    }
    if (!isValidUsername(wanted)) {
      setError(t("profile.usernameChange.errFormat"));
      return;
    }
    const ok = await confirm(t("profile.usernameChange.confirm", { from: username, to: wanted }), {
      confirmLabel: t("profile.usernameChange.submit"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const done = await changeUsername(connection, wanted);
      setEditing(false);
      setNewUsername("");
      setWarnings(done.warnings);
      setNotice(t("profile.usernameChange.done", { username: done.username }));
      setChanges((c) => (c ? { ...c, used: c.used + 1, remaining: done.remaining } : c));
      onChanged(done.username);
      // Move the session to the new name. Should that fail, it keeps its
      // endpoint, which still routes to the account under the former name.
      const endpoint = await endpointForUsername(connection, done.username);
      const next = endpoint ? connectionFor(endpoint) : null;
      if (next) setConnection(next, storedServiceInfoUrl());
    } catch (err: unknown) {
      if (err instanceof UsernameChangeError) {
        setError(refusalMessage(err.refusal, err.message));
        if (err.refusal === "limit") setChanges((c) => (c ? { ...c, remaining: 0 } : c));
      } else {
        setError(t("profile.usernameChange.errFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const canChange = !acting && changes != null && changes.remaining > 0;

  return (
    <Card>
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{t("profile.username")}</div>
          <div className="text-lg" data-testid="profile-username">{username ?? "…"}</div>
        </div>
        {canChange && !editing && (
          <Button
            variant="ghost"
            type="button"
            className="w-auto whitespace-nowrap"
            onClick={() => {
              setNotice(null);
              setWarnings([]);
              setError(null);
              setEditing(true);
            }}
          >
            <Pencil size={14} aria-hidden className="mr-1" /> {t("profile.usernameChange.edit")}
          </Button>
        )}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {warnings.length > 0 && (
        <Alert tone="info">
          <p>{t("profile.usernameChange.warningsIntro")}</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.step}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!acting && changes != null && (
        <p className="mt-1 text-xs text-muted" data-testid="username-changes-left">
          {changes.remaining > 0
            ? t("profile.usernameChange.left", { count: changes.remaining })
            : t("profile.usernameChange.none")}
        </p>
      )}
      {editing && (
        <form onSubmit={onSubmit} className="mt-3">
          {error && <Alert>{error}</Alert>}
          <p className="mb-2 text-sm text-muted">{t("profile.usernameChange.explain")}</p>
          <Field
            id="newUsername"
            label={t("profile.usernameChange.label")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={newUsername}
            hint={usernameRules()}
            onChange={(e) => setNewUsername(normalizeUsernameInput(e.target.value))}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || newUsername.length === 0} className="w-auto">
              {busy ? t("common.saving") : t("profile.usernameChange.submit")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="w-auto"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setNewUsername("");
                setError(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
      {!editing && error && <Alert>{error}</Alert>}
    </Card>
  );
}
