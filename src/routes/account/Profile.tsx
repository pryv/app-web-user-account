import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";

interface AccountInfo {
  username?: string;
  email?: string;
  language?: string;
  storageUsed?: { dbDocuments?: number; attachedFiles?: number };
}

/** Profile overview: username, email (editable), language, storage usage. */
export default function Profile() {
  const { connection } = useSession();
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

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
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">{info?.email ?? "…"}</div>
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
              Edit
            </Button>
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
