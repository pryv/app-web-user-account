import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Pryv } from "../lib/pryvClient";
import { Card, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { ConsentPanel } from "../components/consent/ConsentPanel";
import { consentEntries, grantedPermissions, initialFlags, pickText } from "../lib/consent";
import { assertHttpUrl } from "../lib/safeRedirect";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
  oauth2Accept,
  oauth2Refuse,
  type OAuthState,
} from "../lib/oauth2Flow";
import { trustedApiOrigins } from "../lib/trustedOrigins";
import { brand } from "../brand";
import { useRequestingApp, useStreamLabels } from "../lib/useConsentDisplay";

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
      // Operator allowlist: build-time env + settings.json, never the URL.
      trustedOrigins: trustedApiOrigins(),
      selfOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
      // Production builds MUST carry an explicit allowlist — the weak
      // same-registrable-domain fallback is a dev-only convenience.
      requireAllowlist: import.meta.env.PROD,
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

  // Only looked up once `pryvApi` passed the trust check (initError unset).
  const platformUrl = oauthState != null ? serviceInfoUrlFromPryvApi(pryvApi) : null;
  // The operator's catalog is the only source of a display name for the app;
  // the client id is shown when the catalog does not know it.
  const requestingApp = useRequestingApp(oauthState?.clientId, platformUrl);
  const labelFor = useStreamLabels(platformUrl);

  const entries = useMemo(
    () =>
      oauthState?.offer
        ? consentEntries(oauthState.offer.permissions, {
            allowUserChoice: oauthState.offer.allowUserChoice,
            labelFor,
          })
        : [],
    [oauthState, labelFor],
  );
  // Ticked to begin with, EXCEPT entries the offer marked `optIn`, which
  // the user has to choose deliberately.
  const [grantedFlags, setGrantedFlags] = useState<boolean[]>(() => initialFlags(entries));

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
      // Defence in depth: never navigate to a non-http(s) target even if the
      // core returned one (guards against a `javascript:`/`data:` redirect).
      assertHttpUrl(redirectTo);
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
      assertHttpUrl(redirectTo);
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
        <ConsentPanel
          app={{
            name: requestingApp?.name ?? oauthState.clientId,
            icon: requestingApp?.icon,
            description: requestingApp?.description,
          }}
          appNameId="oauthClientIdText"
          title={
            <>
              {title && <p className="mb-1 text-lg font-medium">{title}</p>}
              {description && <p className="mb-2 text-sm text-muted">{description}</p>}
            </>
          }
          entries={entries}
          flags={grantedFlags}
          idPrefix="oauthScope"
          onToggle={(i, checked) =>
            setGrantedFlags(grantedFlags.map((f, j) => (j === i ? checked : f)))
          }
          afterList={
            consentText && (
              <p id="oauthConsentText" className="mb-2 rounded border border-divider px-3 py-2 text-sm">
                {consentText}
              </p>
            )
          }
          choiceHint={
            <p className="mb-4 text-sm text-muted">
              {offer.allowUserChoice
                ? "Untick to deny specific permissions; the app will receive only the permissions you keep ticked. Entries marked as required cannot be unticked — if you do not agree with them, use Reject."
                : "This request is all-or-nothing: Accept grants every permission listed above, Reject grants none."}
            </p>
          }
          busy={busy}
          acceptId="oauthAccept"
          refuseId="oauthRefuse"
          onAccept={() => void accept()}
          onRefuse={() => void refuse()}
        >
          {error && <Alert>{error}</Alert>}
        </ConsentPanel>
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
          <strong>{requestingApp?.name ?? oauthState.clientId}</strong> wants to access your {brand.accountNoun}.
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
