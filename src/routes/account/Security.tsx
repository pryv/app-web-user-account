import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ShieldOff, Copy, ScrollText, Smartphone, MessageSquare } from "lucide-react";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useSession } from "../../lib/session";

interface Access {
  id: string;
  name: string;
  type?: string;
  lastUsed?: number;
  expires?: number | null;
}

/**
 * Security: MFA enrolment/disable + active personal sessions.
 *
 * MFA supports two methods: an authenticator app (TOTP, the default) and SMS.
 * The server doesn't expose a "is MFA currently enabled?" probe, so the page
 * surfaces both Enable (method chooser) and Disable affordances and lets the
 * user pick — the server rejects a no-op call clearly enough for the UI to
 * relay.
 *
 * MFA uses raw fetch against the REST routes (POST /{user}/mfa/activate +
 * /confirm + /deactivate); these aren't exposed via lib-js's batch API. The
 * activate route answers 302 with a JSON body and no Location header, so a
 * default (follow) fetch returns the body readably.
 */
type EnrollMethod = "totp" | "sms";

export default function Security() {
  const { connection } = useSession();

  // MFA enable flow state
  const [enrollMethod, setEnrollMethod] = useState<EnrollMethod | null>(null);
  const [phone, setPhone] = useState("");
  const [enrollMfaToken, setEnrollMfaToken] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // TOTP enrolment material (from mfa.activate).
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  // MFA methods the server has active (service-info `features.mfa.methods`).
  // null = not yet known; [] = MFA off on this server; else the offered methods.
  const [mfaMethods, setMfaMethods] = useState<EnrollMethod[] | null>(null);

  // Disable state
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableNotice, setDisableNotice] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<Access[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;
    connection.accessInfo().then((info: unknown) => {
      const id = (info as { id?: string } | null)?.id;
      if (id) setSelfId(id);
    }).catch(() => {});
    // Which MFA methods does this server actually offer? Render only those.
    connection.service.info().then((info) => {
      const raw = info?.features?.mfa?.methods;
      if (Array.isArray(raw)) {
        setMfaMethods(raw.filter((m): m is EnrollMethod => m === "totp" || m === "sms"));
      } else {
        // Older core without features.mfa: default to TOTP-only (the shipped
        // default, works with no config) — never advertise unconfigured SMS.
        setMfaMethods(["totp"]);
      }
    }).catch(() => setMfaMethods(["totp"]));
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

  function resetEnroll() {
    setEnrollMethod(null);
    setEnrollMfaToken(null);
    setEnrollCode("");
    setPhone("");
    setOtpauthUri(null);
    setTotpSecret(null);
    setEnrollError(null);
  }

  // POST mfa/activate. The route answers 302 with a JSON body and no Location
  // header, so a default (follow) fetch returns the body; parse it regardless
  // of the 3xx status.
  async function activate(
    payload: Record<string, unknown>,
  ): Promise<{ mfaToken?: string; otpauthUri?: string; secret?: string; method?: string }> {
    const c = rest();
    const res = await fetch(c.endpoint + "mfa/activate", {
      method: "POST",
      headers: { Authorization: c.token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    if (res.status >= 400) {
      throw new Error("activate failed (" + res.status + "): " + text.slice(0, 200));
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Could not read the enrolment response from the server.");
    }
  }

  async function startTotp() {
    setEnrollMethod("totp");
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const body = await activate({ method: "totp" });
      setEnrollMfaToken(body.mfaToken ?? null);
      setOtpauthUri(body.otpauthUri ?? null);
      setTotpSecret(body.secret ?? null);
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : "Could not start setup.");
      // Return to the method chooser so a failed start is recoverable (the QR
      // section, which holds Cancel, never rendered). The error stays visible.
      setEnrollMethod(null);
    } finally {
      setEnrollBusy(false);
    }
  }

  async function startSms(e: React.FormEvent) {
    e.preventDefault();
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const body = await activate({ method: "sms", phone });
      setEnrollMfaToken(body.mfaToken ?? null);
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
      setEnrollMethod(null);
      setOtpauthUri(null);
      setTotpSecret(null);
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
        {!recoveryCodes && !enrollMethod && mfaMethods === null && (
          <p className="mb-3 text-sm text-muted">Loading…</p>
        )}
        {!recoveryCodes && !enrollMethod && mfaMethods !== null && mfaMethods.length === 0 && (
          <p className="mb-3 text-sm text-muted">
            Multi-factor authentication is not enabled on this server.
          </p>
        )}
        {!recoveryCodes && !enrollMethod && mfaMethods !== null && mfaMethods.length > 0 && (
          <div className="mb-3">
            <p className="mb-3 text-sm text-muted">
              {mfaMethods.length > 1
                ? "Add a second step at sign-in. Choose a method:"
                : "Add a second step at sign-in:"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {/* Only methods the operator has actually configured are offered. */}
              {mfaMethods.includes("totp") && (
                <button
                  type="button"
                  onClick={startTotp}
                  disabled={enrollBusy}
                  className="flex items-start gap-2 rounded border border-divider p-3 text-left hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  <Smartphone size={18} className="mt-0.5 text-primary" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">Authenticator app</span>
                    <span className="block text-xs text-muted">
                      Recommended. Google Authenticator, 1Password, etc.
                    </span>
                  </span>
                </button>
              )}
              {mfaMethods.includes("sms") && (
                <button
                  type="button"
                  onClick={() => setEnrollMethod("sms")}
                  disabled={enrollBusy}
                  className="flex items-start gap-2 rounded border border-divider p-3 text-left hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  <MessageSquare size={18} className="mt-0.5 text-primary" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">Text message (SMS)</span>
                    <span className="block text-xs text-muted">Receive a code on your phone.</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Authenticator-app (TOTP) enrolment */}
        {!recoveryCodes && enrollMethod === "totp" && (
          <div className="mb-3">
            {enrollBusy && !otpauthUri && (
              <p className="text-sm text-muted">Preparing your secret…</p>
            )}
            {otpauthUri && (
              <>
                <p className="mb-2 text-sm text-muted">
                  Scan this QR code with your authenticator app, then enter the 6-digit
                  code it shows.
                </p>
                <div className="mb-3 inline-block rounded bg-white p-3">
                  <QRCodeSVG value={otpauthUri} size={160} />
                </div>
                {totpSecret && (
                  <div className="mb-3 text-xs text-muted">
                    Can't scan? Enter this key manually:
                    <div className="mt-1 flex items-center gap-2">
                      <code className="rounded border border-divider px-2 py-1 font-mono text-sm tracking-wider">
                        {totpSecret}
                      </code>
                      <button
                        type="button"
                        title="Copy key"
                        onClick={() => {
                          if (navigator.clipboard) void navigator.clipboard.writeText(totpSecret);
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Copy size={14} aria-hidden /> Copy
                      </button>
                    </div>
                  </div>
                )}
                <form onSubmit={confirmEnroll}>
                  <Field
                    id="mfa-code"
                    label="Code from your app"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={enrollBusy || !enrollCode} className="w-auto">
                      {enrollBusy ? "Confirming…" : "Confirm"}
                    </Button>
                    <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                      Cancel
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {/* SMS enrolment */}
        {!recoveryCodes && enrollMethod === "sms" && !enrollMfaToken && (
          <form onSubmit={startSms} className="mb-3">
            <p className="mb-2 text-sm text-muted">
              We'll send a code to your phone to verify.
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
            <div className="flex gap-2">
              <Button type="submit" disabled={enrollBusy || !phone} className="w-auto">
                {enrollBusy ? "Sending code…" : "Send code"}
              </Button>
              <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                Cancel
              </Button>
            </div>
          </form>
        )}
        {!recoveryCodes && enrollMethod === "sms" && enrollMfaToken && (
          <form onSubmit={confirmEnroll} className="mb-3">
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
            <div className="flex gap-2">
              <Button type="submit" disabled={enrollBusy || !enrollCode} className="w-auto">
                {enrollBusy ? "Confirming…" : "Confirm"}
              </Button>
              <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                Cancel
              </Button>
            </div>
          </form>
        )}
        <div className="mt-3 border-t border-divider pt-3">
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
              className="flex items-center justify-between gap-3 rounded border border-divider p-3"
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
              <Link
                to={`/account/audit-access/${encodeURIComponent(s.id)}`}
                className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ScrollText size={12} aria-hidden />
                Details
              </Link>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
