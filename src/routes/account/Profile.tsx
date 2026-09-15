import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";
import { emailBadge, verificationOnAccount, type EmailView } from "../../lib/emailVerification";

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

const BADGE_LABEL: Record<string, string> = {
  verified: "Verified",
  pending: "Not verified",
  unconfirmed: "Unconfirmed",
};

/** Profile overview: username, email (editable), language, storage usage. */
export default function Profile() {
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

  async function load() {
    if (!connection) return;
    setError(null);
    try {
      const [res] = (await connection.api([
        { method: "account.get", params: {} },
      ])) as Array<{ account?: AccountInfo; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      setInfo(res?.account ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
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
          typeof wait === "number" ? `Please wait ${wait} seconds.` : res.error.message,
        );
      }
      setEmailNotice(`Verification link sent to ${value}. Open it to confirm this address.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send the verification link.");
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
      setEmailNotice("Added. A verification link was sent.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add the email address.");
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
      setEmailNotice("Email updated.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update email.");
    } finally {
      setSavingEmail(false);
    }
  }

  return (
    <section className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="text-xs uppercase tracking-wide text-muted">Username</div>
        <div className="text-lg">{info?.username ?? "…"}</div>
      </Card>
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Email</div>
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
                      <span className="rounded px-2 py-0.5 text-xs bg-body text-muted">Primary</span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${BADGE_STYLE[badge]}`}
                      title={
                        badge === "unconfirmed"
                          ? "Confirm this address to prove you own it"
                          : undefined
                      }
                    >
                      {BADGE_LABEL[badge]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {onAccount && badge !== "verified" && (
                      <Button
                        variant="ghost"
                        type="button"
                        className="w-auto"
                        disabled={emailBusy}
                        onClick={() => void onResend(view.value)}
                      >
                        Send verification link
                      </Button>
                    )}
                    {view.primary && (
                      <Button
                        variant="ghost"
                        type="button"
                        className="w-auto"
                        onClick={() => {
                          setEmailNotice(null);
                          setNewEmail(info?.email ?? "");
                          setEditingEmail(true);
                        }}
                      >
                        <Pencil size={14} aria-hidden className="mr-1" /> Edit
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {!onAccount && (
              <p className="text-xs text-muted">
                Email verification is not available on this platform.
              </p>
            )}
            {onAccount &&
              (addingEmail ? (
                <form onSubmit={onAddEmail}>
                  <Field
                    id="newSecondaryEmail"
                    label="New email address"
                    type="email"
                    value={secondaryEmail}
                    onChange={(e) => setSecondaryEmail(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" className="w-auto" disabled={emailBusy}>
                      {emailBusy ? "Adding…" : "Add"}
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
                      Cancel
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
                  Add an email
                </Button>
              ))}
          </div>
        ) : (
          <form onSubmit={onSubmitEmail}>
            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={savingEmail} className="w-auto">
                {savingEmail ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="w-auto"
                onClick={() => setEditingEmail(false)}
                disabled={savingEmail}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>
      {info?.language && (
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Language</div>
          <div className="text-sm">{info.language}</div>
        </Card>
      )}
      {info?.storageUsed && (
        <Card>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">Storage</div>
          <div className="text-sm text-muted">
            {info.storageUsed.dbDocuments ?? 0} events · {info.storageUsed.attachedFiles ?? 0} bytes attached
          </div>
        </Card>
      )}
      <Card>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Password</div>
        <Link to="/change-password" className="text-sm text-primary hover:underline">
          Change your password
        </Link>
      </Card>
    </section>
  );
}
