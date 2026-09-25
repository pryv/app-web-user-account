import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert, SelectField } from "../../components/ui";
import { useSession } from "../../lib/session";
import { emailBadge, verificationOnAccount, type EmailView } from "../../lib/emailVerification";
import { LANGUAGE_OPTIONS } from "../../lib/languages";
import ProfileExtensions from "../../extensions/ProfileExtensions";
import i18n, { syncLocaleFromAccount } from "../../i18n";

interface AccountInfo {
  username?: string;
  email?: string;
  emails?: EmailView[];
  language?: string;
  storageUsed?: { dbDocuments?: number; attachedFiles?: number };
}

const BADGE_STYLE: Record<string, string> = {
  verified: "bg-success/10 text-success",
  pending: "bg-info/10 text-info",
  unconfirmed: "bg-body text-muted",
};

/** Profile overview: username, email (editable), language, storage usage. */
export default function Profile() {
  const { t } = useTranslation();
  const { connection } = useSession();
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [onAccount, setOnAccount] = useState(false);
  const [addingEmail, setAddingEmail] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);

  async function load() {
    if (!connection) return;
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "account.get", params: {} },
      ])) as Array<{ account?: AccountInfo; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setInfo(res?.account ?? null);
      syncLocaleFromAccount(res?.account?.language);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("profile.errLoadProfile"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  // Whether this platform offers verification on an existing account. Absent on
  // an older core, in which case the actions stay hidden rather than failing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!connection) return;
      try {
        const info = await connection.service.info();
        if (!cancelled) setOnAccount(verificationOnAccount(info as never));
      } catch {
        if (!cancelled) setOnAccount(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // The server synthesises this same view for accounts created before the
  // container existed, so mirror it rather than showing an empty list.
  const emails: EmailView[] =
    info?.emails ??
    (info?.email
      ? [
          {
            value: info.email,
            primary: true,
            status: "verified",
            verifiedAt: null,
            verificationMethod: "registration",
          },
        ]
      : []);

  async function onResend(value: string) {
    if (!connection) return;
    setError(null);
    setEmailNotice(null);
    setEmailBusy(true);
    try {
      const [res] = (await connection.api([
        { method: "account.update", params: { update: { emails: { resend: [value] } } } },
      ])) as Array<{ error?: { message: string; data?: { retryAfterSeconds?: number } } }>;
      if (res?.error) {
        const wait = res.error.data?.retryAfterSeconds;
        throw new Error(
          typeof wait === "number" ? t("profile.errRetryAfter", { seconds: wait }) : res.error.message,
        );
      }
      setEmailNotice(t("profile.emailLinkSent", { email: value }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("profile.errSendVerification"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function onAddEmail(e: FormEvent) {
    e.preventDefault();
    if (!connection || !secondaryEmail) return;
    setError(null);
    setEmailNotice(null);
    setEmailBusy(true);
    try {
      const [res] = (await connection.api([
        { method: "account.update", params: { update: { emails: { add: [secondaryEmail] } } } },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setSecondaryEmail("");
      setAddingEmail(false);
      await load();
      setEmailNotice(t("profile.emailAddedNotice"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("profile.errAddEmail"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function onSubmitEmail(e: FormEvent) {
    e.preventDefault();
    if (!connection || !newEmail || newEmail === info?.email) {
      setEditingEmail(false);
      return;
    }
    setSavingEmail(true);
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "account.update", params: { update: { email: newEmail } } },
      ])) as Array<{ account?: AccountInfo; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setInfo(res?.account ?? null);
      setEditingEmail(false);
      setEmailNotice(t("profile.emailUpdatedNotice"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("profile.errUpdateEmail"));
    } finally {
      setSavingEmail(false);
    }
  }

  async function onLanguageChange(language: string) {
    if (!connection || language === info?.language) return;
    setSavingLanguage(true);
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "account.update", params: { update: { language } } },
      ])) as Array<{ account?: AccountInfo; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setInfo(res?.account ?? null);
      void i18n.changeLanguage(language);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("profile.errUpdateLanguage"));
    } finally {
      setSavingLanguage(false);
    }
  }

  return (
    <section className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="text-xs uppercase tracking-wide text-muted">{t("profile.username")}</div>
        <div className="text-lg">{info?.username ?? "…"}</div>
      </Card>
      {connection && info?.username && (
        <ProfileExtensions connection={connection} username={info.username} />
      )}
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("profile.email")}</div>
        {emailNotice && <Alert tone="success">{emailNotice}</Alert>}
        {!editingEmail ? (
          <div className="space-y-3">
            {emails.length === 0 && <div className="text-sm">…</div>}
            {emails.map((view) => {
              const badge = emailBadge(view);
              return (
                <div key={view.value} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{view.value}</span>
                    {view.primary && (
                      <span className="rounded px-2 py-0.5 text-xs bg-body text-muted">{t("profile.emailPrimary")}</span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${BADGE_STYLE[badge]}`}
                      title={
                        badge === "unconfirmed"
                          ? t("profile.emailUnconfirmedHint")
                          : undefined
                      }
                    >
                      {t(`profile.emailBadge.${badge}`)}
                    </span>
                  </div>
                  {/* Unshrinkable group with no-wrap labels: Button's base is
                      `inline-flex w-full`, so under pressure the longest label broke
                      onto three lines; this way the parent's flex-wrap moves the
                      actions to their own row instead. */}
                  <div className="flex shrink-0 items-center gap-2">
                    {onAccount && badge !== "verified" && (
                      <Button
                        variant="ghost"
                        type="button"
                        className="w-auto whitespace-nowrap"
                        disabled={emailBusy}
                        onClick={() => void onResend(view.value)}
                      >
                        <Send size={14} aria-hidden className="mr-1" /> {t("profile.emailSendLink")}
                      </Button>
                    )}
                    {view.primary && (
                      <Button
                        variant="ghost"
                        type="button"
                        className="w-auto whitespace-nowrap"
                        onClick={() => {
                          setEmailNotice(null);
                          setNewEmail(info?.email ?? "");
                          setEditingEmail(true);
                        }}
                      >
                        <Pencil size={14} aria-hidden className="mr-1" /> {t("common.edit")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {!onAccount && (
              <p className="text-xs text-muted">
                {t("profile.emailVerificationUnavailable")}
              </p>
            )}
            {onAccount &&
              (addingEmail ? (
                <form onSubmit={onAddEmail}>
                  <Field
                    id="newSecondaryEmail"
                    label={t("profile.emailAddLabel")}
                    type="email"
                    value={secondaryEmail}
                    onChange={(e) => setSecondaryEmail(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" className="w-auto" disabled={emailBusy}>
                      {emailBusy ? t("profile.emailAdding") : t("profile.emailAdd")}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      className="w-auto"
                      disabled={emailBusy}
                      onClick={() => {
                        setAddingEmail(false);
                        setSecondaryEmail("");
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="ghost"
                  type="button"
                  className="w-auto"
                  onClick={() => {
                    setEmailNotice(null);
                    setAddingEmail(true);
                  }}
                >
                  <Plus size={14} aria-hidden className="mr-1" /> {t("profile.emailAddAnother")}
                </Button>
              ))}
          </div>
        ) : (
          <form onSubmit={onSubmitEmail}>
            <Field
              id="email"
              label={t("profile.email")}
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={savingEmail} className="w-auto">
                {savingEmail ? t("common.saving") : t("common.save")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="w-auto"
                onClick={() => setEditingEmail(false)}
                disabled={savingEmail}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
      </Card>
      {/* A choice only when there is one to make; otherwise read-only. */}
      {info && LANGUAGE_OPTIONS.length > 1 ? (
        <Card>
          <SelectField
            id="language"
            label={t("profile.language")}
            value={info.language ?? LANGUAGE_OPTIONS[0].value}
            options={LANGUAGE_OPTIONS}
            disabled={savingLanguage}
            onChange={(v) => void onLanguageChange(v)}
          />
        </Card>
      ) : (
        info?.language && (
          <Card>
            <div className="text-xs uppercase tracking-wide text-muted">{t("profile.language")}</div>
            <div className="text-sm">{info.language}</div>
          </Card>
        )
      )}
      {info?.storageUsed && (
        <Card>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("profile.storage")}</div>
          <div className="text-sm text-muted">
            {t("profile.storageDetail", {
              documents: info.storageUsed.dbDocuments ?? 0,
              bytes: info.storageUsed.attachedFiles ?? 0,
            })}
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("profile.password")}</div>
        <Link to="/change-password" className="text-sm text-primary hover:underline">
          {t("profile.changePassword")}
        </Link>
      </Card>
    </section>
  );
}
