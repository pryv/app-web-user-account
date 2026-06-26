import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldOff, XCircle, Copy } from "lucide-react";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useSession, signinPath } from "../../lib/session";

interface Access {
  id: string;
  name: string;
  type?: string;
  lastUsed?: number;
  expires?: number | null;
}

/**
 * Security: SMS-based MFA enrolment/disable + active personal sessions.
 *
 * The server doesn't expose a "is MFA currently enabled?" probe, so the page
 * surfaces both Enable and Disable affordances and lets the user pick — the
 * server will reject a no-op call clearly enough for the UI to relay.
 *
 * MFA uses raw fetch against the REST routes (POST /{user}/mfa/activate +
 * /confirm + /deactivate); these aren't exposed via lib-js's batch API.
 */
export default function Security() {
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();

  // MFA enable flow state
  const [phone, setPhone] = useState("");
  const [enrollMfaToken, setEnrollMfaToken] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable state
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableNotice, setDisableNotice] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<Access[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    connection.accessInfo().then((info: unknown) => {
      const id = (info as { id?: string } | null)?.id;
      if (id) setSelfId(id);
    }).catch(() => {});
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  async function loadSessions() {
    if (!connection) return;
    setSessionsError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.get", params: {} },
      ])) as Array<{ accesses?: Access[]; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      const personal = (res?.accesses ?? []).filter((a) => a.type === "personal");
      setSessions(personal);
    } catch (err: unknown) {
      setSessionsError(err instanceof Error ? err.message : "Could not load sessions.");
    }
  }

  function rest() {
    if (!connection) throw new Error("not signed in");
    const c = connection as unknown as { endpoint: string; token: string };
    return c;
  }

  async function startEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const c = rest();
      const res = await fetch(c.endpoint + "mfa/activate", {
        method: "POST",
        headers: { Authorization: c.token, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
        // mfa.activate returns 302 on success per the open-pryv.io route binding.
        redirect: "manual",
      });
      if (!res.ok && res.status !== 302 && res.type !== "opaqueredirect") {
        throw new Error("activate failed (" + res.status + "): " + (await res.text()).slice(0, 200));
      }
      // 302 has no readable body cross-origin; the success signal IS the 302.
      // The mfaToken is only obtainable via the body when the server returns
      // 200; if the server returns a 302 we ask the user to look in the SMS
      // text alone and proceed via challenge re-send.
      const body = await res.text().catch(() => "");
      let token: string | null = null;
      try {
        token = body ? (JSON.parse(body) as { mfaToken?: string }).mfaToken ?? null : null;
      } catch {
        token = null;
      }
      setEnrollMfaToken(token);
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : "Could not start enrolment.");
    } finally {
      setEnrollBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollMfaToken) {
      setEnrollError(
        "The server didn't return an enrolment token after sending the code. Disable + re-enable to retry.",
      );
      return;
    }
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const c = rest();
      const res = await fetch(c.endpoint + "mfa/confirm", {
        method: "POST",
        headers: { Authorization: enrollMfaToken, "Content-Type": "application/json" },
        body: JSON.stringify({ code: enrollCode }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error("confirm failed (" + res.status + "): " + body.slice(0, 200));
      const parsed = body ? (JSON.parse(body) as { recoveryCodes?: string[] }) : {};
      setRecoveryCodes(parsed.recoveryCodes ?? []);
      setEnrollMfaToken(null);
      setEnrollCode("");
      setPhone("");
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : "Could not confirm code.");
    } finally {
      setEnrollBusy(false);
    }
  }

  async function deactivate() {
    if (!connection) return;
    if (!window.confirm("Disable multi-factor authentication on this account?")) return;
    setDisableBusy(true);
    setDisableError(null);
    setDisableNotice(null);
    try {
      const c = rest();
      const res = await fetch(c.endpoint + "mfa/deactivate", {
        method: "POST",
        headers: { Authorization: c.token, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error("deactivate failed (" + res.status + "): " + body.slice(0, 200));
      }
      setDisableNotice("Multi-factor authentication is now off.");
    } catch (err: unknown) {
      setDisableError(err instanceof Error ? err.message : "Could not disable MFA.");
    } finally {
      setDisableBusy(false);
    }
  }

  async function revokeSession(id: string) {
    if (!connection) return;
    if (id === selfId) {
      if (!window.confirm("This is the session you're using to sign in. Revoking it will sign you out. Continue?")) return;
    }
    setRevoking(id);
    setSessionsError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.delete", params: { id } },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      if (id === selfId) {
        // Navigate FIRST — see AccountLayout signOut for the same race fix.
        const target = signinPath();
        navigate(target, { replace: true });
        setConnection(null);
        return;
      }
      await loadSessions();
    } catch (err: unknown) {
      setSessionsError(err instanceof Error ? err.message : "Could not revoke session.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <section className="space-y-4">
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          Multi-factor authentication
        </div>
        {recoveryCodes && (
          <Alert tone="success">
            <div className="mb-1 flex items-center justify-between gap-2 font-medium">
              <span>MFA enabled — save these recovery codes:</span>
              <button
                type="button"
                title="Copy to clipboard"
                onClick={() => {
                  if (navigator.clipboard) {
                    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
                  }
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
              >
                <Copy size={14} aria-hidden /> Copy
              </button>
            </div>
            <ul className="font-mono text-xs">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        )}
        {disableNotice && <Alert tone="success">{disableNotice}</Alert>}
        {disableError && <Alert>{disableError}</Alert>}
        {enrollError && <Alert>{enrollError}</Alert>}
        {!enrollMfaToken && !recoveryCodes && (
          <form onSubmit={startEnroll} className="mb-3">
            <p className="mb-2 text-sm text-muted">
              Enable SMS-based MFA. We'll send a code to your phone to verify.
            </p>
            <Field
              id="mfa-phone"
              label="Mobile phone (international format, e.g. +41…)"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Button type="submit" disabled={enrollBusy || !phone} className="w-auto">
              {enrollBusy ? "Sending code…" : "Send code"}
            </Button>
          </form>
        )}
        {enrollMfaToken && (
          <form onSubmit={confirmEnroll}>
            <p className="mb-2 text-sm text-muted">
              We sent a code to <strong>{phone}</strong>. Enter it below to confirm.
            </p>
            <Field
              id="mfa-code"
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              required
            />
            <Button type="submit" disabled={enrollBusy || !enrollCode} className="w-auto">
              {enrollBusy ? "Confirming…" : "Confirm"}
            </Button>
          </form>
        )}
        <div className="mt-3 border-t border-pryv-light-gray pt-3">
          <p className="mb-2 text-xs text-muted">
            Already enrolled? Disable it here:
          </p>
          <button
            type="button"
            onClick={deactivate}
            disabled={disableBusy}
            className="inline-flex items-center gap-1 rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
          >
            <ShieldOff size={14} aria-hidden />
            {disableBusy ? "Disabling…" : "Disable MFA"}
          </button>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          Active sessions
        </div>
        <p className="mb-3 text-sm text-muted">
          Personal access tokens minted by sign-ins. Revoke any you don't recognise.
        </p>
        {sessionsError && <Alert>{sessionsError}</Alert>}
        {sessions === null && !sessionsError && <p className="text-sm text-muted">Loading…</p>}
        {sessions?.length === 0 && <p className="text-sm text-muted">No active sessions.</p>}
        <div className="space-y-2">
          {sessions?.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded border border-pryv-light-gray p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {s.name}
                  {s.id === selfId && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      this session
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {s.lastUsed
                    ? "Last used: " + new Date(s.lastUsed * 1000).toLocaleString()
                    : "Never used"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revokeSession(s.id)}
                disabled={revoking === s.id}
                className="inline-flex items-center gap-1 rounded border border-danger px-3 py-1 text-xs text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
              >
                <XCircle size={12} aria-hidden />
                {revoking === s.id ? "Revoking…" : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
