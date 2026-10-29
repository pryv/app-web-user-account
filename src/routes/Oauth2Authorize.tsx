import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useLocation } from "react-router-dom";
import { Pryv } from "../lib/pryvClient";
import { Card, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { ConsentPanel } from "../components/consent/ConsentPanel";
import { tNodes } from "../components/consent/tNodes";
import { consentEntries, grantedPermissions, initialFlags, offerEntryLabel, pickText } from "../lib/consent";
import { ACCOUNT_APP_CONSENT_ID } from "../lib/accountApp";
import { storedSessionTokens } from "../lib/sessionStore";
import { streamNamesResolver, NO_STREAM_LABELS, type StreamLabelResolver } from "../lib/streamLabels";
import { assertHttpUrl } from "../lib/safeRedirect";
import { navigateTo } from "../lib/returnTarget";
import {
  parseOAuthState,
  serviceInfoUrlFromPryvApi,
  assertTrustedPryvApi,
  oauth2Accept,
  oauth2Refuse,
  oauth2FetchOffer,
  endConsentSession,
  identityNoticeKey,
  type OAuthClientDisplay,
  type OAuthFlowError,
  type OAuthOffer,
  type OAuthState,
} from "../lib/oauth2Flow";
import { trustedApiOrigins } from "../lib/trustedOrigins";
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
      initError: i18n.t("oauth.errorMissingState"),
    };
  }
  if (!pryvApi) {
    return {
      oauthState: null,
      signedState,
      pryvApi,
      initError: i18n.t("oauth.errorMissingPryvApi"),
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
    // A client registered without an app account sends the offer by
    // reference: it is fetched once the page is up.
    if (oauthState.offer == null && oauthState.offerRef == null) {
      return {
        oauthState: null,
        signedState,
        pryvApi,
        initError: i18n.t("oauth.errorNoOffer"),
      };
    }
    return { oauthState, signedState, pryvApi, initError: null };
  } catch (err: unknown) {
    return {
      oauthState: null,
      signedState,
      pryvApi,
      initError: err instanceof Error ? err.message : i18n.t("oauth.invalidRequest"),
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
 * The sign-in uses this app's consent appId (never the client id, see
 * `ACCOUNT_APP_CONSENT_ID`), and the personal session it opens is ended once
 * Accept or Reject is answered, unless the core handed back a session this
 * app keeps open in this browser.
 */
export default function Oauth2Authorize() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { search } = useLocation();
  const { oauthState, signedState, pryvApi, initError } = useMemo(
    () => initFromQuery(search),
    [search],
  );

  const [busy, setBusy] = useState<"accept" | "refuse" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Offer by reference: fetched from the core with the signed state.
  const [fetched, setFetched] = useState<{ offer: OAuthOffer; client: OAuthClientDisplay } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const needsFetch = oauthState != null && oauthState.offer == null && oauthState.offerRef != null;
  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    oauth2FetchOffer({ pryvApi, signedState })
      .then((r) => { if (!cancelled) setFetched(r); })
      .catch((err: unknown) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : i18n.t("cmc.errorReadOffer"));
      });
    return () => { cancelled = true; };
  }, [needsFetch, pryvApi, signedState]);
  const offer: OAuthOffer | null = oauthState?.offer ?? fetched?.offer ?? null;

  // Session captured by the shared sign-in (+ MFA) — gates consent.
  const [username, setUsername] = useState("");
  const [personalToken, setPersonalToken] = useState<string | null>(null);
  const [sessionEndpoint, setSessionEndpoint] = useState<string | null>(null);
  // The account's own stream names, read with the personal session.
  const [accountName, setAccountName] = useState<StreamLabelResolver>(() => NO_STREAM_LABELS);

  // Only looked up once `pryvApi` passed the trust check (initError unset).
  const platformUrl = oauthState != null ? serviceInfoUrlFromPryvApi(pryvApi) : null;
  // The operator's catalog is the only source of a display name for the app;
  // the client id is shown when the catalog does not know it.
  const catalogApp = useRequestingApp(oauthState?.clientId, platformUrl);
  // A client with no catalog entry is named by its own registration.
  const requestingApp = catalogApp ?? (fetched?.client.name
    ? {
        name: fetched.client.name,
        icon: fetched.client.logoUri ? { type: "url" as const, value: fetched.client.logoUri } : undefined,
        description: undefined,
      }
    : null);
  const labelFor = useStreamLabels(platformUrl);
  const lang = i18nInstance.language || "en";

  const entries = useMemo(
    () =>
      offer
        ? consentEntries(offer.permissions, {
            allowUserChoice: offer.allowUserChoice,
            entryLabel: offerEntryLabel(offer.entryLabels, lang),
            labelFor,
            accountName,
          })
        : [],
    [offer, labelFor, accountName, lang],
  );
  // Ticked to begin with, EXCEPT entries the offer marked `optIn`, which
  // the user has to choose deliberately. Reset when a fetched offer arrives.
  const [grantedFlags, setGrantedFlags] = useState<boolean[]>(() => initialFlags(entries));
  const [flagsOffer, setFlagsOffer] = useState<OAuthOffer | null>(offer);
  if (flagsOffer !== offer) {
    setFlagsOffer(offer);
    setGrantedFlags(initialFlags(entries));
  }

  function makeService() {
    return new Pryv.Service(serviceInfoUrlFromPryvApi(pryvApi));
  }

  /**
   * End the personal session this page opened, once the consent is answered.
   * A session this app keeps open in this browser is left alone: the core
   * hands back a live session of the same appId rather than opening another.
   * Never throws and is time-bounded, so the redirect always follows.
   */
  async function endOwnSession() {
    if (personalToken == null || sessionEndpoint == null) return;
    if (storedSessionTokens().includes(personalToken)) return;
    await endConsentSession({ endpoint: sessionEndpoint, token: personalToken });
  }

  async function accept() {
    if (!offer || !personalToken) return;
    setBusy("accept");
    setError(null);
    try {
      // Locked entries (all-or-nothing offers, mandatory entries) are
      // always granted; ticked optional entries follow the checkboxes.
      // The consent-layer `mandatory` flag never travels in the grant.
      const granted = grantedPermissions(entries, grantedFlags);
      if (granted.length === 0) {
        setError(t("oauth.errorKeepOne"));
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
      await endOwnSession();
      // Defence in depth: never navigate to a non-http(s) target even if the
      // core returned one (guards against a `javascript:`/`data:` redirect).
      assertHttpUrl(redirectTo);
      navigateTo(redirectTo);
    } catch (err: unknown) {
      if ((err as OAuthFlowError)?.status === 401) {
        // The session no longer authenticates: most likely a consent on
        // another device shared it and ended it when it finished. Back to
        // the sign-in, which opens a fresh one.
        setPersonalToken(null);
        setSessionEndpoint(null);
        setAccountName(() => NO_STREAM_LABELS);
        setError(t("oauth.errorSessionEnded"));
      } else {
        setError(err instanceof Error ? err.message : t("oauth.errorAcceptFailed"));
      }
      setBusy(null);
    }
  }

  async function refuse() {
    setBusy("refuse");
    setError(null);
    try {
      const redirectTo = await oauth2Refuse({ pryvApi, signedState });
      await endOwnSession();
      assertHttpUrl(redirectTo);
      navigateTo(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("oauth.errorRefuseFailed"));
      setBusy(null);
    }
  }

  if (initError || fetchError || !oauthState) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("oauth.invalidTitle")}</h1>
        <div id="oauthInitError">
          <Alert>{initError ?? fetchError ?? t("oauth.invalidRequest")}</Alert>
        </div>
      </Card>
    );
  }

  if (personalToken && !offer) {
    return (
      <Card>
        <p id="oauthLoadingOffer">{t("cmc.loadingOffer")}</p>
      </Card>
    );
  }

  // Consent panel — visible once signed in (+ MFA). Renders the offer's
  // granular permission set (full lexicon, incl. feature permissions);
  // when the offer allows user choice, unticking downgrades: the app
  // receives only the ticked subset.
  if (personalToken && offer) {
    // The offer's texts in the UI language when the app supplied it
    // (`pickText` falls back from a regional variant to its base language).
    const title = pickText(offer.title, lang);
    const description = pickText(offer.description, lang);
    const consentText = pickText(offer.consent, lang);
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
              {identityNoticeKey(offer) && (
                <p id="oauthIdentityNotice" className="mb-2 text-sm">{t(identityNoticeKey(offer) as string)}</p>
              )}
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
                ? t("oauth.untickHintRequired")
                : t("oauth.allOrNothingHint")}
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
      appId={ACCOUNT_APP_CONSENT_ID}
      usernameHint={oauthState.userIdHint ?? ""}
      prompt={
        <span id="oauthAppPrompt">
          {tNodes("oauth.appPromptLine", {
            app: <strong>{requestingApp?.name ?? oauthState.clientId}</strong>,
          })}
        </span>
      }
      onSignedIn={({ username: u, personalToken: token, endpoint, connection }) => {
        setUsername(u);
        setPersonalToken(token);
        setSessionEndpoint(endpoint);
        void loadAccountStreamNames(connection).then((r) => setAccountName(() => r));
      }}
      onCancel={() => void refuse()}
      cancelId="oauthCancelLogin"
      cancelDisabled={busy !== null}
      externalError={error}
    />
  );
}

/**
 * The account's stream names, read with the consent's personal session, so a
 * stream that already exists is shown by the name the user knows. Display
 * only: a failure leaves the other sources in charge.
 */
async function loadAccountStreamNames(connection: unknown): Promise<StreamLabelResolver> {
  const api = (connection as { api?: unknown } | null)?.api;
  if (typeof api !== "function") return NO_STREAM_LABELS;
  try {
    const results = (await (api as (calls: unknown[]) => Promise<unknown[]>).call(connection, [
      { method: "streams.get", params: {} },
    ])) as Array<{ streams?: unknown }>;
    return streamNamesResolver(results?.[0]?.streams);
  } catch {
    return NO_STREAM_LABELS;
  }
}
