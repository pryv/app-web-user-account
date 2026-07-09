import { useMemo, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import Pryv from "pryv";
import { Card, Button, Field, Alert } from "../components/ui";
import { isMfaRequired, resolveUserId } from "../lib/service";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
  permissionLabel,
  pickText,
  oauth2Accept,
  oauth2Refuse,
  type OAuthState,
} from "../lib/oauth2Flow";

/** Operator allowlist of trusted core origins for `pryvApi` (build-time env). */
const TRUSTED_API_ORIGINS = (import.meta.env.VITE_OAUTH_TRUSTED_API_ORIGINS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

interface InitResult {
  oauthState: OAuthState | null;
  signedState: string;
  pryvApi: string;
  initError: string | null;
}

function initFromQuery(search: string): InitResult {
  const p = new URLSearchParams(search);
  const signedState = p.get("state") ?? "";
  const pryvApi = p.get("pryvApi") ?? "";
  if (!signedState) {
    return {
      oauthState: null,
      signedState,
      pryvApi,
      initError: "Missing required `state` query parameter.",
    };
  }
  if (!pryvApi) {
    return {
      oauthState: null,
      signedState,
      pryvApi,
      initError: "Missing required `pryvApi` query parameter.",
    };
  }
  try {
    // Reject an untrusted `pryvApi` BEFORE anything sends credentials to it.
    assertTrustedPryvApi(pryvApi, {
      trustedOrigins: TRUSTED_API_ORIGINS,
      selfOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    const oauthState = parseOAuthState(signedState);
    if (oauthState.offer == null) {
      return {
        oauthState: null,
        signedState,
        pryvApi,
        initError:
          "This authorization request carries no consent offer — restart the flow from the app.",
      };
    }
    return { oauthState, signedState, pryvApi, initError: null };
  } catch (err: unknown) {
    return {
      oauthState: null,
      signedState,
      pryvApi,
      initError: err instanceof Error ? err.message : "Invalid authorization request.",
    };
  }
}

/**
 * OAuth2 (RFC 6749) authorize/consent flow. The core's `GET /oauth2/authorize`
 * validates the client + PKCE parameters and 302-redirects the browser here
 * with `state` (signed payload, display-only — see `lib/oauth2Flow.ts`) and
 * `pryvApi` (the API endpoint to call back). The user signs in (username or
 * email, MFA-aware), reviews the requested scopes (unticking downgrades),
 * then Accept/Reject POSTs back to the core, which answers with the redirect
 * URL for the requesting app.
 *
 * Sign-in is always fresh — `userIdHint` only prefills the username; the
 * persisted session is deliberately not reused on this security surface.
 */
export default function Oauth2Authorize() {
  const { search } = useLocation();
  const { oauthState, signedState, pryvApi, initError } = useMemo(
    () => initFromQuery(search),
    [search],
  );

  const [username, setUsername] = useState(oauthState?.userIdHint ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  // Personal token captured after successful login (+ MFA) — gates consent.
  const [personalToken, setPersonalToken] = useState<string | null>(null);

  const [grantedFlags, setGrantedFlags] = useState<boolean[]>(() =>
    (oauthState?.offer?.permissions ?? []).map(() => true),
  );

  function makeService() {
    return new Pryv.Service(serviceInfoUrlFromPryvApi(pryvApi));
  }

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (!oauthState) return;
    setBusy(true);
    setError(null);
    try {
      const service = makeService();
      // Emails resolve to the username first; the resolved id feeds login,
      // the MFA steps and the accept payload below.
      const userId = await resolveUserId(service, username);
      setUsername(userId);
      // Service.login signature: (username, password, appId) — the OAuth
      // clientId doubles as the appId of the personal session.
      let connection;
      try {
        connection = (await service.login(userId, password, oauthState.clientId)) as unknown as {
          token: string;
        };
      } catch (err) {
        if (isMfaRequired(err)) {
          const mt = (err as { mfaToken: string }).mfaToken;
          await service.mfaChallenge(userId, mt);
          setMfaToken(mt);
          return;
        }
        throw err;
      }
      setPersonalToken(connection.token);
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
      // `mfaVerify` returns a Connection; pull its token.
      const conn = (await service.mfaVerify(username.trim(), mfaToken, mfaCode)) as unknown as {
        token?: string;
      };
      const token = conn.token ?? (conn as unknown as string);
      setPersonalToken(typeof token === "string" ? token : null);
      setMfaToken(null);
      setMfaCode("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "MFA verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!oauthState?.offer || !personalToken) return;
    setBusy(true);
    setError(null);
    try {
      const grantedPermissions = oauthState.offer.permissions.filter((_p, i) => grantedFlags[i]);
      if (grantedPermissions.length === 0) {
        setError("Keep at least one permission ticked, or use Reject.");
        setBusy(false);
        return;
      }
      const redirectTo = await oauth2Accept({
        pryvApi,
        signedState,
        username,
        personalToken,
        grantedPermissions,
      });
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept authorization.");
      setBusy(false);
    }
  }

  async function refuse() {
    setBusy(true);
    setError(null);
    try {
      const redirectTo = await oauth2Refuse({ pryvApi, signedState });
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to refuse authorization.");
      setBusy(false);
    }
  }

  if (initError || !oauthState) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Invalid authorization request</h1>
        <div id="oauthInitError">
          <Alert>{initError ?? "Invalid authorization request."}</Alert>
        </div>
      </Card>
    );
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

  // Consent panel — visible once signed in (+ MFA). Renders the offer's
  // granular permission set (full lexicon, incl. feature permissions);
  // unticking downgrades: the app receives only the ticked subset.
  if (personalToken && oauthState.offer) {
    const offer = oauthState.offer;
    const title = pickText(offer.title);
    const description = pickText(offer.description);
    const consentText = pickText(offer.consent);
    return (
      <Card>
        <h1 id="oauthClientIdText" className="mb-2 text-2xl">
          <strong>{oauthState.clientId}</strong>
        </h1>
        {title && <p className="mb-1 text-lg font-medium">{title}</p>}
        {description && <p className="mb-2 text-sm text-muted">{description}</p>}
        <p className="mb-2 text-sm">is requesting permission:</p>
        <ul className="mb-2 space-y-1 text-sm">
          {offer.permissions.map((p, i) => (
            <li key={i} className="rounded bg-body px-3 py-2">
              <label className="flex items-center gap-2">
                <input
                  id={"oauthScope-" + i}
                  type="checkbox"
                  checked={grantedFlags[i]}
                  onChange={(e) =>
                    setGrantedFlags(grantedFlags.map((f, j) => (j === i ? e.target.checked : f)))
                  }
                />
                <span>{permissionLabel(p)}</span>
              </label>
            </li>
          ))}
        </ul>
        {consentText && (
          <p id="oauthConsentText" className="mb-2 rounded border border-divider px-3 py-2 text-sm">
            {consentText}
          </p>
        )}
        <p className="mb-4 text-sm text-muted">
          Untick to deny specific permissions; the app will receive only the permissions you keep
          ticked.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button id="oauthAccept" type="button" disabled={busy} onClick={accept}>
            {busy ? "Approving…" : "Accept"}
          </Button>
          <button
            id="oauthRefuse"
            type="button"
            disabled={busy}
            onClick={refuse}
            className="inline-flex w-full items-center justify-center rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            {busy ? "Declining…" : "Reject"}
          </button>
        </div>
      </Card>
    );
  }

  // Sign-in form (initial state). Cancel refuses the authorization —
  // refuse needs no user session, so it works pre-login.
  return (
    <Card>
      <h1 className="mb-1 text-2xl">Sign in</h1>
      <p id="oauthAppPrompt" className="mb-6 text-sm text-muted">
        <strong>{oauthState.clientId}</strong> wants to access your Pryv account.
      </p>
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
          <Button id="oauthCancelLogin" variant="ghost" type="button" onClick={refuse} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
