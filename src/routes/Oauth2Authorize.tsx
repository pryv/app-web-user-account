import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import Pryv from "pryv";
import { Card, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import { consentEntries, grantedPermissions, pickText } from "../lib/consent";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
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
 * email, MFA-aware), reviews the requested permissions (unticking downgrades
 * when the offer allows user choice), then Accept/Reject POSTs back to the
 * core, which answers with the redirect URL for the requesting app.
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

  const [busy, setBusy] = useState<"accept" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Session captured by the shared sign-in (+ MFA) — gates consent.
  const [username, setUsername] = useState("");
  const [personalToken, setPersonalToken] = useState<string | null>(null);

  const entries = useMemo(
    () =>
      oauthState?.offer
        ? consentEntries(oauthState.offer.permissions, {
            allowUserChoice: oauthState.offer.allowUserChoice,
          })
        : [],
    [oauthState],
  );
  const [grantedFlags, setGrantedFlags] = useState<boolean[]>(() => entries.map(() => true));

  function makeService() {
    return new Pryv.Service(serviceInfoUrlFromPryvApi(pryvApi));
  }

  async function accept() {
    if (!oauthState?.offer || !personalToken) return;
    setBusy("accept");
    setError(null);
    try {
      // Locked entries (all-or-nothing offers, mandatory entries) are
      // always granted; ticked optional entries follow the checkboxes.
      // The consent-layer `mandatory` flag never travels in the grant.
      const granted = grantedPermissions(entries, grantedFlags);
      if (granted.length === 0) {
        setError("Keep at least one permission ticked, or use Reject.");
        setBusy(null);
        return;
      }
      const redirectTo = await oauth2Accept({
        pryvApi,
        signedState,
        username,
        personalToken,
        grantedPermissions: granted,
      });
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept authorization.");
      setBusy(null);
    }
  }

  async function refuse() {
    setBusy("refuse");
    setError(null);
    try {
      const redirectTo = await oauth2Refuse({ pryvApi, signedState });
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to refuse authorization.");
      setBusy(null);
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

  // Consent panel — visible once signed in (+ MFA). Renders the offer's
  // granular permission set (full lexicon, incl. feature permissions);
  // when the offer allows user choice, unticking downgrades: the app
  // receives only the ticked subset.
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
        <PermissionList
          entries={entries}
          flags={grantedFlags}
          idPrefix="oauthScope"
          onToggle={(i, checked) =>
            setGrantedFlags(grantedFlags.map((f, j) => (j === i ? checked : f)))
          }
        />
        {consentText && (
          <p id="oauthConsentText" className="mb-2 rounded border border-divider px-3 py-2 text-sm">
            {consentText}
          </p>
        )}
        <p className="mb-4 text-sm text-muted">
          {offer.allowUserChoice
            ? "Untick to deny specific permissions; the app will receive only the permissions you keep ticked. Entries marked as required cannot be unticked — if you do not agree with them, use Reject."
            : "This request is all-or-nothing: Accept grants every permission listed above, Reject grants none."}
        </p>
        {error && <Alert>{error}</Alert>}
        <ConsentActions
          busy={busy}
          acceptId="oauthAccept"
          refuseId="oauthRefuse"
          onAccept={() => void accept()}
          onRefuse={() => void refuse()}
        />
      </Card>
    );
  }

  // Shared sign-in gate (initial state). Cancel refuses the authorization —
  // refuse needs no user session, so it works pre-login.
  return (
    <ConsentSignIn
      makeService={makeService}
      appId={oauthState.clientId}
      usernameHint={oauthState.userIdHint ?? ""}
      prompt={
        <span id="oauthAppPrompt">
          <strong>{oauthState.clientId}</strong> wants to access your Pryv account.
        </span>
      }
      onSignedIn={({ username: u, personalToken: token }) => {
        setUsername(u);
        setPersonalToken(token);
      }}
      onCancel={() => void refuse()}
      cancelId="oauthCancelLogin"
      cancelDisabled={busy !== null}
      externalError={error}
    />
  );
}
