import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Card, Button, Field, Alert } from "../components/ui";
import { getService, isMfaRequired, resolveUserId } from "../lib/service";
import { parseAuthParams } from "../lib/authParams";
import { signedInTarget } from "../lib/signInCompletion";
import { useSession, type PryvConnection } from "../lib/session";
import {
  fetchSsoProviders,
  coreOriginFromApiEndpoint,
  ssoStartUrl,
  type SsoProvider,
} from "../lib/ssoLanding";
import { buildSsoReturn, stashSsoReturn } from "../lib/ssoReturn";

/**
 * Sign-in / authorize. Calls `Service.login`; on `MfaRequiredError` it routes to
 * `/mfa-challenge` carrying the `mfaToken`; on success it completes the auth flow.
 */
export default function SignIn() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { connection, setConnection } = useSession();
  // `?username=` is a sign-in hint from the calling app. It fills the field only
  // while it is empty, so it never replaces what the user typed.
  const usernameHint = parseAuthParams(search).username;
  const [username, setUsername] = useState(usernameHint ?? "");
  useEffect(() => {
    if (usernameHint) setUsername((current) => current || usernameHint);
  }, [usernameHint]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([]);
  const [ssoOrigin, setSsoOrigin] = useState<string | null>(null);

  // Third-party sign-in buttons, when the operator configured providers. Best
  // effort: any failure (no service-info, feature off, network) leaves the page
  // password-only. `apiEndpointFor` only builds a URL, so the placeholder user
  // need not exist; SSO is dnsLess-only, so the core origin is shared.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const service = getService(search);
        const origin = coreOriginFromApiEndpoint(await service.apiEndpointFor("_"));
        const providers = await fetchSsoProviders(origin);
        if (!cancelled) {
          setSsoOrigin(origin);
          setSsoProviders(providers);
        }
      } catch {
        if (!cancelled) setSsoProviders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

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

  function completeSignedIn(conn: PryvConnection) {
    const target = signedInTarget(search, conn.endpoint);
    if (target.kind === "external") {
      window.location.href = target.href;
      return;
    }
    navigate(target.path);
  }

  function continueAs() {
    if (!connection) return;
    completeSignedIn(connection);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    let userId = username;
    try {
      const { appId, serviceInfoUrl } = parseAuthParams(search);
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
      completeSignedIn(connection);
    } catch (err: unknown) {
      if (isMfaRequired(err)) {
        navigate("/mfa-challenge", {
          state: { userId, mfaToken: err.mfaToken, method: (err as { method?: string }).method, search },
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
      {ssoOrigin && ssoProviders.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
            <span className="h-px flex-1 bg-divider" />
            or
            <span className="h-px flex-1 bg-divider" />
          </div>
          <div className="flex flex-col gap-2">
            {ssoProviders.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  // Keep the app's return context across the provider
                  // round-trip: an allow-listed subset rides the core, the
                  // full query stays in this tab. See lib/ssoReturn.ts.
                  const { value, nonce } = buildSsoReturn(search);
                  stashSsoReturn(nonce, search);
                  window.location.href = ssoStartUrl(ssoOrigin, p.id, value);
                }}
                className="w-full rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Sign in with {p.label ?? p.id}
              </button>
            ))}
          </div>
        </div>
      )}
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
