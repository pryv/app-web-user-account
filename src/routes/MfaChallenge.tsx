import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { signedInTarget } from "../lib/signInCompletion";
import { useSession, type PryvConnection } from "../lib/session";

interface MfaState {
  userId?: string;
  mfaToken?: string;
  method?: string;
  search?: string;
}

/**
 * Multi-factor challenge. Used inline after sign-in, and launchable standalone
 * (e.g. by a CLI) with `userId` + `mfaToken`. Submits the code via
 * `Service.mfaVerify`; supports resending via `Service.mfaChallenge`.
 */
export default function MfaChallenge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setConnection } = useSession();
  const state = (location.state ?? {}) as MfaState;
  const search = state.search ?? location.search;
  const params = new URLSearchParams(location.search);

  const userId = state.userId ?? params.get("userId") ?? "";
  const mfaToken = state.mfaToken ?? params.get("mfaToken") ?? "";
  const method = state.method ?? params.get("method") ?? undefined;
  const isTotp = method === "totp";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ready = Boolean(userId && mfaToken);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const connection = (await getService(search).mfaVerify(
        userId,
        mfaToken,
        code,
      )) as unknown as PryvConnection;
      const { serviceInfoUrl } = parseAuthParams(search);
      setConnection(connection, serviceInfoUrl);
      // Same completion decision as a password or third-party sign-in. This
      // also restores `pryvServiceInfoUrl` on the profile fallback, which the
      // old inline `/account` default dropped.
      const target = signedInTarget(search, connection.endpoint);
      if (target.kind === "external") {
        window.location.href = target.href;
      } else {
        navigate(target.path);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mfa.verificationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      await getService(search).mfaChallenge(userId, mfaToken);
      setNotice(t("mfa.codeSent"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mfa.resendFailed"));
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{t("mfa.title")}</h1>
      <p className="mb-6 text-sm text-muted">
        {isTotp
          ? t("mfa.subtitleTotp")
          : t("mfa.subtitle")}
      </p>
      {!ready && (
        <Alert>{t("mfa.linkInvalid")}</Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="code"
          label={isTotp ? t("mfa.codeLabelTotp") : t("mfa.codeLabel")}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={!ready}
          required
        />
        <Button type="submit" disabled={!ready || busy}>
          {busy ? t("mfa.verifyingButton") : t("mfa.submit")}
        </Button>
      </form>
      {/* TOTP codes are generated on the user's device — nothing to resend. */}
      {!isTotp && (
        <div className="mt-4 text-sm">
          <Button variant="ghost" type="button" onClick={resend} disabled={!ready}>
            {t("mfa.resend")}
          </Button>
        </div>
      )}
    </Card>
  );
}
