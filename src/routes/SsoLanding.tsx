import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Pryv from "pryv";
import { Card, Button, Alert } from "../components/ui";
import { getService } from "../lib/service";
import { parseAuthParams, buildCompletionUrl } from "../lib/authParams";
import { useSession, type PryvConnection } from "../lib/session";
import { parseSsoHash, ssoErrorMessage } from "../lib/ssoLanding";

/** `Pryv.SharedSecrets` exists at runtime but is absent from the package typings;
 *  a precise local shape keeps the call type-checked without `any`. */
const sharedSecrets = (Pryv as unknown as {
  SharedSecrets: {
    retrieve: (apiEndpoint: string, key: string) => Promise<{ secret: { token: string; apiEndpoint: string } }>;
  };
}).SharedSecrets;

/**
 * Third-party sign-in landing page (the core's `sso.landingPageURL`).
 *
 * The callback result arrives on the URL FRAGMENT. We capture it and clear the
 * fragment BEFORE any network call, so the one-time key / mfaToken never
 * lingers in the address bar or history. Then:
 *   - login → redeem the one-time key for the session (the long-lived token was
 *     never in the URL) and complete the auth flow, same terminal state as a
 *     password sign-in;
 *   - mfa   → hand off to the existing `/mfa-challenge` continuation;
 *   - error → show a coarse, user-facing message.
 *
 * The page must be opened with `pryvServiceInfoUrl` in the query (operators put
 * it on `sso.landingPageURL`), so `getService` can resolve the core.
 */
export default function SsoLanding() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { setConnection } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const outcome = parseSsoHash(window.location.hash);
    // Strip the fragment immediately, before any await.
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      // Non-fatal: some embedded contexts forbid replaceState.
    }

    if (outcome.kind === "error") {
      setError(ssoErrorMessage(outcome.code));
      return;
    }
    if (outcome.kind === "none") {
      setStandalone(true);
      return;
    }
    if (outcome.kind === "mfa") {
      navigate("/mfa-challenge", {
        state: {
          userId: outcome.user,
          mfaToken: outcome.mfaToken,
          method: outcome.mfaMethod ?? undefined,
          search,
        },
      });
      return;
    }

    // outcome.kind === "login": redeem the one-time key for the session.
    void (async () => {
      try {
        const service = getService(search);
        const apiEndpoint = await service.apiEndpointFor(outcome.user);
        const redeemed = await sharedSecrets.retrieve(apiEndpoint, outcome.key);
        const connection = new Pryv.Connection(
          redeemed.secret.apiEndpoint,
          service,
        ) as unknown as PryvConnection;
        const { returnURL, serviceInfoUrl, state } = parseAuthParams(search);
        setConnection(connection, serviceInfoUrl);
        if (returnURL) {
          window.location.href = buildCompletionUrl(returnURL, connection.endpoint, state);
        } else {
          navigate(
            serviceInfoUrl
              ? "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(serviceInfoUrl)
              : "/account/profile",
          );
        }
      } catch (err: unknown) {
        const id = err != null && typeof err === "object" ? (err as { id?: string }).id : undefined;
        setError(
          id === "shared-secret-unavailable"
            ? "This sign-in link has expired. Please start over from sign-in."
            : ssoErrorMessage("sso-failed"),
        );
      }
    })();
  }, [navigate, search, setConnection]);

  return (
    <Card>
      <h1 className="mb-1 text-2xl">Signing you in…</h1>
      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={() => navigate(`/signin${search}`)} className="mt-4">
            Back to sign-in
          </Button>
        </>
      ) : standalone ? (
        <>
          <p className="mb-4 text-sm text-muted">
            Open this page from the sign-in screen to continue.
          </p>
          <Button type="button" onClick={() => navigate(`/signin${search}`)}>
            Go to sign-in
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">Completing your third-party sign-in.</p>
      )}
    </Card>
  );
}
