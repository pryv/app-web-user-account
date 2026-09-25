import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ShieldOff, Copy, ScrollText, Smartphone, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../../components/ui";
import { useConfirm } from "../../components/ConfirmDialog";
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
  const { t } = useTranslation();
  const { connection } = useSession();
  const [confirm, confirmDialog] = useConfirm();

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
      setSessionsError(err instanceof Error ? err.message : t("security.errorLoadSessions"));
    }
  }

  function rest() {
    if (!connection) throw new Error(t("common.notSignedIn"));
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
      throw new Error(t("security.activateFailed", { status: res.status, body: text.slice(0, 200) }));
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(t("security.errorUnreadableEnrollResponse"));
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
      setEnrollError(err instanceof Error ? err.message : t("security.errorStartSetup"));
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
      setEnrollError(err instanceof Error ? err.message : t("security.errorStartEnroll"));
    } finally {
      setEnrollBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollMfaToken) {
      setEnrollError(t("security.errorNoEnrollToken"));
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
      if (!res.ok) throw new Error(t("security.confirmFailed", { status: res.status, body: body.slice(0, 200) }));
      const parsed = body ? (JSON.parse(body) as { recoveryCodes?: string[] }) : {};
      setRecoveryCodes(parsed.recoveryCodes ?? []);
      setEnrollMfaToken(null);
      setEnrollCode("");
      setPhone("");
      setEnrollMethod(null);
      setOtpauthUri(null);
      setTotpSecret(null);
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : t("security.errorConfirmCode"));
    } finally {
      setEnrollBusy(false);
    }
  }

  async function deactivate() {
    if (!connection) return;
    if (!(await confirm(t("security.confirmDisable"), { confirmLabel: t("security.disable"), danger: true }))) return;
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
        throw new Error(t("security.deactivateFailed", { status: res.status, body: body.slice(0, 200) }));
      }
      setDisableNotice(t("security.mfaNowOff"));
    } catch (err: unknown) {
      setDisableError(err instanceof Error ? err.message : t("security.errorDisableMfa"));
    } finally {
      setDisableBusy(false);
    }
  }


  return (
    <section className="space-y-4">
      {confirmDialog}
      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          {t("security.mfaHeading")}
        </div>
        {recoveryCodes && (
          <Alert tone="success">
            <div className="mb-1 flex items-center justify-between gap-2 font-medium">
              <span>{t("security.recoveryCodesSave")}</span>
              <button
                type="button"
                title={t("common.copyToClipboard")}
                onClick={() => {
                  if (navigator.clipboard) {
                    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
                  }
                }}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
              >
                <Copy size={14} aria-hidden /> {t("common.copy")}
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
          <p className="mb-3 text-sm text-muted">{t("common.loading")}</p>
        )}
        {!recoveryCodes && !enrollMethod && mfaMethods !== null && mfaMethods.length === 0 && (
          <p className="mb-3 text-sm text-muted">
            {t("security.mfaNotAvailable")}
          </p>
        )}
        {!recoveryCodes && !enrollMethod && mfaMethods !== null && mfaMethods.length > 0 && (
          <div className="mb-3">
            <p className="mb-3 text-sm text-muted">
              {mfaMethods.length > 1
                ? t("security.chooseMethod")
                : t("security.addSecondStep")}
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
                    <span className="block text-sm font-medium">{t("security.methodTotpTitle")}</span>
                    <span className="block text-xs text-muted">
                      {t("security.methodTotpHint")}
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
                    <span className="block text-sm font-medium">{t("security.methodSmsTitle")}</span>
                    <span className="block text-xs text-muted">{t("security.methodSmsHint")}</span>
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
              <p className="text-sm text-muted">{t("security.preparingTotpSecret")}</p>
            )}
            {otpauthUri && (
              <>
                <p className="mb-2 text-sm text-muted">
                  {t("security.scanQr")}
                </p>
                <div className="mb-3 inline-block rounded bg-white p-3">
                  <QRCodeSVG value={otpauthUri} size={160} />
                </div>
                {totpSecret && (
                  <div className="mb-3 text-xs text-muted">
                    {t("security.cannotScanManual")}
                    <div className="mt-1 flex items-center gap-2">
                      <code className="rounded border border-divider px-2 py-1 font-mono text-sm tracking-wider">
                        {totpSecret}
                      </code>
                      <button
                        type="button"
                        title={t("security.copyKey")}
                        onClick={() => {
                          if (navigator.clipboard) void navigator.clipboard.writeText(totpSecret);
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Copy size={14} aria-hidden /> {t("common.copy")}
                      </button>
                    </div>
                  </div>
                )}
                <form onSubmit={confirmEnroll}>
                  <Field
                    id="mfa-code"
                    label={t("security.codeFromAppLabel")}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={enrollBusy || !enrollCode} className="w-auto">
                      {enrollBusy ? t("common.confirming") : t("common.confirm")}
                    </Button>
                    <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                      {t("common.cancel")}
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
              {t("security.smsIntro")}
            </p>
            <Field
              id="mfa-phone"
              label={t("security.phoneLabel")}
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={enrollBusy || !phone} className="w-auto">
                {enrollBusy ? t("security.sendingCode") : t("security.sendCode")}
              </Button>
              <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
        {!recoveryCodes && enrollMethod === "sms" && enrollMfaToken && (
          <form onSubmit={confirmEnroll} className="mb-3">
            <p className="mb-2 text-sm text-muted">
              {t("security.codeSentTo")} <strong>{phone}</strong>. {t("security.codeSentToConfirm")}
            </p>
            <Field
              id="mfa-code"
              label={t("security.verificationCodeLabel")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={enrollCode}
              onChange={(e) => setEnrollCode(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={enrollBusy || !enrollCode} className="w-auto">
                {enrollBusy ? t("common.confirming") : t("common.confirm")}
              </Button>
              <Button variant="ghost" type="button" onClick={resetEnroll} className="w-auto">
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        )}
        <div className="mt-3 border-t border-divider pt-3">
          <p className="mb-2 text-xs text-muted">
            {t("security.alreadyEnrolled")}
          </p>
          <button
            type="button"
            onClick={deactivate}
            disabled={disableBusy}
            className="inline-flex items-center gap-1 rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
          >
            <ShieldOff size={14} aria-hidden />
            {disableBusy ? t("security.disabling") : t("security.disableMfa")}
          </button>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          {t("security.activeSessions")}
        </div>
        <p className="mb-3 text-sm text-muted">
          {t("security.sessionsIntro")}
        </p>
        {sessionsError && <Alert>{sessionsError}</Alert>}
        {sessions === null && !sessionsError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {sessions?.length === 0 && <p className="text-sm text-muted">{t("security.noSessions")}</p>}
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
                      {t("common.thisSession")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {s.lastUsed
                    ? t("security.lastUsedLabel") + new Date(s.lastUsed * 1000).toLocaleString()
                    : t("security.neverUsed")}
                </div>
              </div>
              <Link
                to={`/account/audit-access/${encodeURIComponent(s.id)}`}
                className="inline-flex items-center gap-1 rounded border border-divider px-3 py-1 text-xs text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ScrollText size={12} aria-hidden />
                {t("common.details")}
              </Link>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}
