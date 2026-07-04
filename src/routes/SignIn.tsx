import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService, isMfaRequired, resolveUserId } from "../lib/service";
import { parseAuthParams, buildCompletionUrl } from "../lib/authParams";
import { useSession, type PryvConnection } from "../lib/session";

/**
 * Sign-in / authorize. Calls `Service.login`; on `MfaRequiredError` it routes to
 * `/mfa-challenge` carrying the `mfaToken`; on success it completes the auth flow.
 */
export default function SignIn() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { connection, setConnection } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A session persisted from an earlier sign-in (localStorage) lets the user
  // continue without re-entering credentials. "Not me" clears it so a
  // different account can sign in — important when this page completes an
  // auth hand-off for a third-party app.
  const [knownUsername, setKnownUsername] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) {
      setKnownUsername(null);
      return;
    }
    let cancelled = false;
    connection
      .username()
      .then((u) => {
        if (!cancelled) setKnownUsername(u);
      })
      .catch(() => {
        if (!cancelled) setKnownUsername(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  function completeSignedIn(conn: PryvConnection, serviceInfoUrl: string | null, returnURL: string | null, state: string | null) {
    if (returnURL) {
      window.location.href = buildCompletionUrl(returnURL, conn.endpoint, state);
      return;
    }
    const target = serviceInfoUrl
      ? "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(serviceInfoUrl)
      : "/account/profile";
    navigate(target);
  }

  function continueAs() {
    if (!connection) return;
    const { returnURL, serviceInfoUrl, state } = parseAuthParams(search);
    completeSignedIn(connection, serviceInfoUrl, returnURL, state);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    let userId = username;
    try {
      const { appId, returnURL, serviceInfoUrl, state } = parseAuthParams(search);
      const service = getService(search);
      userId = await resolveUserId(service, username);
      const connection = (await service.login(
        userId,
        password,
        appId,
      )) as unknown as PryvConnection;
      setConnection(connection, serviceInfoUrl);
      // Carry pryvServiceInfoUrl into the account section so sign-out and
      // every account-side <Navigate> can preserve it from useLocation().search
      // without depending on localStorage state (which gets cleared when
      // setConnection(null) runs, racing AccountLayout's re-render).
      completeSignedIn(connection, serviceInfoUrl, returnURL, state);
    } catch (err: unknown) {
      if (isMfaRequired(err)) {
        navigate("/mfa-challenge", {
          state: { userId, mfaToken: err.mfaToken, search },
        });
        return;
      }
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  if (connection) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">Welcome back</h1>
        <p className="mb-6 text-sm text-muted">
          You are already signed in{knownUsername ? (
            <>
              {" "}as <strong>{knownUsername}</strong>
            </>
          ) : null}
          .
        </p>
        <Button type="button" onClick={continueAs}>
          Continue{knownUsername ? ` as ${knownUsername}` : ""}
        </Button>
        <button
          type="button"
          onClick={() => setConnection(null)}
          className="mt-3 w-full rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Not me — use another account
        </button>
      </Card>
    );
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
