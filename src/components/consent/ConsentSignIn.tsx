import { useState, type FormEvent, type ReactNode } from "react";
import { Card, Button, Field, Alert } from "../ui";
import { isMfaRequired, resolveUserId } from "../../lib/service";

/**
 * Minimal lib-js `Service` surface the sign-in needs — the flow supplies
 * the concrete instance (its service-info URL resolution differs per flow).
 */
export interface SignInService {
  login(username: string, password: string, appId: string): Promise<unknown>;
  mfaChallenge(username: string, mfaToken: string): Promise<unknown>;
  mfaVerify(username: string, mfaToken: string, code: string): Promise<unknown>;
  userIdForEmail?(email: string): Promise<string | null>;
}

/** What a completed sign-in (+ MFA) hands back to the flow. */
export interface SignedIn {
  /** Resolved username (emails are resolved before login). */
  username: string;
  personalToken: string;
  /** Bare API endpoint when the login response carries one. */
  endpoint: string | null;
  /** The raw lib-js login/mfaVerify result (a Connection-like object). */
  connection: unknown;
}

function extractSession(result: unknown): { token: string | null; endpoint: string | null } {
  const c = result as { token?: unknown; endpoint?: unknown } | null;
  const token =
    typeof c?.token === "string" ? c.token : typeof result === "string" ? result : null;
  return { token, endpoint: typeof c?.endpoint === "string" ? c.endpoint : null };
}

/**
 * The ONE sign-in gate for every consent surface: username-or-email +
 * password, MFA-aware (challenge + inline verification panel), with a
 * Cancel wired to the flow's refuse/deny action.
 *
 * Session policy stays with the flow: this component never touches the
 * persisted session — flows that persist (legacy `/auth`) do it in
 * `onSignedIn`; the OAuth flow deliberately signs in fresh every time.
 */
export function ConsentSignIn({
  makeService,
  appId,
  usernameHint = "",
  heading = "Sign in",
  prompt,
  onSignedIn,
  onCancel,
  cancelId,
  cancelDisabled = false,
  externalError = null,
  footer,
}: {
  makeService: () => SignInService;
  /** appId recorded on the personal session (`Service.login` third arg). */
  appId: string;
  usernameHint?: string;
  heading?: ReactNode;
  /** Sub-text under the heading (who is asking and why). */
  prompt?: ReactNode;
  /**
   * Called once a personal token is obtained (after MFA when required).
   * May be async; a throw is displayed as the form error.
   */
  onSignedIn: (session: SignedIn) => void | Promise<void>;
  /** Renders a Cancel button wired to the flow's refuse when provided. */
  onCancel?: () => void;
  cancelId?: string;
  cancelDisabled?: boolean;
  /** Flow-level error to display (e.g. a failed Cancel/refuse). */
  externalError?: string | null;
  /** Extra content under the form (register / password-reset links…). */
  footer?: ReactNode;
}) {
  const [username, setUsername] = useState(usernameHint);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [internalError, setError] = useState<string | null>(null);
  const error = internalError ?? externalError ?? null;

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  async function finish(userId: string, result: unknown) {
    const { token, endpoint } = extractSession(result);
    if (!token) throw new Error("Sign-in did not return a session token.");
    await onSignedIn({ username: userId, personalToken: token, endpoint, connection: result });
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const service = makeService();
      // Emails resolve to the username first; the resolved id feeds login,
      // the MFA steps and the flow's accept payload.
      const userId = await resolveUserId(service, username);
      setUsername(userId);
      let result: unknown;
      try {
        result = await service.login(userId, password, appId);
      } catch (err) {
        if (isMfaRequired(err)) {
          const mt = (err as { mfaToken: string }).mfaToken;
          await service.mfaChallenge(userId, mt);
          setMfaToken(mt);
          return;
        }
        throw err;
      }
      await finish(userId, result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      const service = makeService();
      const userId = username.trim();
      const result = await service.mfaVerify(userId, mfaToken, mfaCode);
      setMfaToken(null);
      setMfaCode("");
      await finish(userId, result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "MFA verification failed.");
    } finally {
      setBusy(false);
    }
  }

  // MFA dialog (inline panel) — shown when login surfaces an mfaToken.
  if (mfaToken) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">Verify it's you</h1>
        <p className="mb-4 text-sm text-muted">
          Enter the verification code we sent to confirm sign-in.
        </p>
        {error && <Alert>{error}</Alert>}
        <form onSubmit={submitMfa}>
          <Field
            id="mfaCode"
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !mfaCode}>
              {busy ? "Verifying…" : "Verify"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setMfaToken(null);
                setMfaCode("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">{heading}</h1>
      {prompt && <p className="mb-6 text-sm text-muted">{prompt}</p>}
      {error && <Alert>{error}</Alert>}
      <form onSubmit={submitLogin}>
        <Field
          id="usernameOrEmail"
          label="Username or email"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </Button>
          {onCancel && (
            <Button
              id={cancelId}
              variant="ghost"
              type="button"
              onClick={onCancel}
              disabled={busy || cancelDisabled}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
      {footer}
    </Card>
  );
}
