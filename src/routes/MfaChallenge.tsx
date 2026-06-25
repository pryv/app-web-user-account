import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";

interface MfaState {
  userId?: string;
  mfaToken?: string;
  search?: string;
}

/**
 * Multi-factor challenge. Used inline after sign-in, and launchable standalone
 * (e.g. by a CLI) with `userId` + `mfaToken`. Submits the code via
 * `Service.mfaVerify`; supports resending via `Service.mfaChallenge`.
 */
export default function MfaChallenge() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as MfaState;
  const search = state.search ?? location.search;
  const params = new URLSearchParams(location.search);

  const userId = state.userId ?? params.get("userId") ?? "";
  const mfaToken = state.mfaToken ?? params.get("mfaToken") ?? "";

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
      await getService(search).mfaVerify(userId, mfaToken, code);
      const { returnURL } = parseAuthParams(search);
      if (returnURL) window.location.href = returnURL;
      else navigate("/account");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      await getService(search).mfaChallenge(userId, mfaToken);
      setNotice("A new code has been sent.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend the code.");
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Verify it's you</h1>
      <p className="mb-6 text-sm text-muted">
        Enter the verification code to continue.
      </p>
      {!ready && (
        <Alert>This challenge link is missing or expired. Start over from sign-in.</Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="code"
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={!ready}
          required
        />
        <Button type="submit" disabled={!ready || busy}>
          {busy ? "Verifying…" : "Verify"}
        </Button>
      </form>
      <div className="mt-4 text-sm">
        <Button variant="ghost" type="button" onClick={resend} disabled={!ready}>
          Resend code
        </Button>
      </div>
    </Card>
  );
}
