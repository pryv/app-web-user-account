import { useState, useEffect, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { verifyEmailToken, emailVerificationErrorMessage, ApiCallError } from "../lib/emailVerification";

/**
 * Landing page for the verification email.
 *
 * The mailed link carries both the token and the username, because the core
 * cannot look an account up from an address once emails are stored hashed. The
 * token stays editable so someone who received the mail on another device can
 * type it in here instead of following the link.
 */
export default function VerifyEmail() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const usernameFromQuery = params.get("username") ?? "";
  const [username, setUsername] = useState(usernameFromQuery);
  const [token, setToken] = useState(params.get("verifyToken") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The token has been read into state; drop it from the address bar so the
  // history entry and any outbound Referer do not carry it. Same-path replace,
  // so the back button is unaffected.
  useEffect(() => {
    if (!params.has("verifyToken")) return;
    const kept = new URLSearchParams(window.location.search);
    kept.delete("verifyToken");
    const q = kept.toString();
    window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
    // Once, on mount: the token is already in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { appId } = parseAuthParams(search);
      const service = getService(search);
      const apiEndpoint = await service.apiEndpointFor(username.trim().toLowerCase());
      const email = await verifyEmailToken(apiEndpoint, appId, token.trim());
      setDone(email);
    } catch (err: unknown) {
      if (err instanceof ApiCallError && err.id === "invalid-access-token") {
        setError(
          "This verification code is invalid or has expired. Request a new one from your account page.",
        );
      } else {
        setError(emailVerificationErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    // Carry the platform context on, but not the spent token: it has no further
    // use and would otherwise follow the reader into their history and Referer.
    const onward = new URLSearchParams(search);
    onward.delete("verifyToken");
    onward.delete("username");
    const onwardSearch = onward.toString() ? `?${onward.toString()}` : "";
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Email verified</h1>
        <Alert tone="success">{done} is now confirmed on your account.</Alert>
        <div className="mt-4 flex flex-col gap-2 text-sm">
          <Link to={`/account/profile${onwardSearch}`} className="text-primary hover:underline">
            Go to your account
          </Link>
          <Link to={`/signin${onwardSearch}`} className="text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Verify your email address</h1>
      <p className="mb-6 text-sm text-muted">
        Paste the code from the verification email, or open the link it contains.
      </p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        {usernameFromQuery ? (
          <div className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">Username</div>
            <div className="text-sm">{usernameFromQuery}</div>
          </div>
        ) : (
          <Field
            id="username"
            label="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        )}
        <Field
          id="verifyToken"
          label="Verification code"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Verifying…" : "Verify email"}
        </Button>
      </form>
    </Card>
  );
}
