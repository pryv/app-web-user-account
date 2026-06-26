import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService, isMfaRequired } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { useSession, type PryvConnection } from "../lib/session";

/**
 * Sign-in / authorize. Calls `Service.login`; on `MfaRequiredError` it routes to
 * `/mfa-challenge` carrying the `mfaToken`; on success it completes the auth flow.
 */
export default function SignIn() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { setConnection } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { appId, returnURL, serviceInfoUrl } = parseAuthParams(search);
      const connection = (await getService(search).login(
        username,
        password,
        appId,
      )) as unknown as PryvConnection;
      // TODO: complete the auth flow (append state/poll/code to returnURL).
      if (returnURL) window.location.href = returnURL;
      else {
        setConnection(connection, serviceInfoUrl);
        navigate("/account");
      }
    } catch (err: unknown) {
      if (isMfaRequired(err)) {
        navigate("/mfa-challenge", {
          state: { userId: username, mfaToken: err.mfaToken, search },
        });
        return;
      }
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Sign in</h1>
      <p className="mb-6 text-sm text-muted">
        Sign in to grant access to the requesting app.
      </p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Field
          id="username"
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
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to={`/reset-password${search}`} className="text-primary hover:underline">
          Forgot password?
        </Link>
        <Link to={`/register${search}`} className="text-primary hover:underline">
          Create account
        </Link>
      </div>
    </Card>
  );
}
