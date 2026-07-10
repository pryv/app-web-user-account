import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Pryv from "pryv";
import { Card, Button, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import { consentEntries, type OfferPermission } from "../lib/consent";
import { useSession, storedServiceInfoUrl, type PryvConnection } from "../lib/session";
import {
  loadAccessState,
  updateAccessState,
  checkAppAccess,
  createAppAccess,
  deleteAppAccess,
  closeOrRedirect,
  deriveServiceInfoUrlFromPollUrl,
  type AccessState,
  type AppCheck,
} from "../lib/accessFlow";

const APP_ID = "pryv-app-web-user-account";

interface AuthQuery {
  pollUrl: string | null;
  serviceInfoUrl: string | null;
  lang: string;
  cli: boolean;
  oauthState: string | null;
}

function parseAuthQuery(search: string): AuthQuery {
  const p = new URLSearchParams(search);
  // Service-info URL: callers historically send `serviceInfo=` (the name
  // open-pryv.io's `/access` route appends to the authUrl it returns) —
  // accept that alongside our own `pryvServiceInfoUrl` so the page works
  // unchanged when reached via `Service.setupAuth(...)`.
  return {
    pollUrl: p.get("poll") ?? p.get("pollUrl"),
    serviceInfoUrl: p.get("pryvServiceInfoUrl") ?? p.get("serviceInfo"),
    lang: p.get("lang") || "en",
    cli: p.get("cli") === "1",
    oauthState: p.get("oauthState"),
  };
}

/**
 * Access-request authorization flow (the legacy popup-and-poll consent
 * UI). Reached from `Service.setupAuth` callers via `Service.access` /
 * `register.access`. The query carries `poll=<pollUrl>` — the GET of that
 * URL returns the access state (status, requested permissions, returnURL,
 * etc). After the user signs in + accepts, we POST a new app access
 * (deleting any mismatching prior access first) and POST the result back
 * to `pollUrl`; finally we either close the popup or redirect to
 * `returnURL` with the legacy `prYv*` params the lib-js consumer reads.
 *
 * Sign-in, permission render and Accept/Reject come from the shared
 * consent kit (`components/consent/`); this container keeps only the
 * legacy wire protocol (poll state, check-app, access creation). The
 * legacy access-request grammar has no `mandatory`/`allowUserChoice`
 * annotations — the permission list renders all-or-nothing.
 *
 * Mirrors app-web-auth3's `Authorization.vue` + `bits/Permissions.vue` +
 * `ops/{login,check_access,accept_access,refuse_access,close_or_redirect,
 * mfa_verify}` — same wire shape, same outcomes.
 */
export default function Auth() {
  const { search } = useLocation();
  const query = parseAuthQuery(search);
  const { connection: storedConnection, setConnection } = useSession();

  const [accessState, setAccessState] = useState<AccessState | null>(null);
  const [serviceInfo, setServiceInfo] = useState<{ register?: string; support?: string; api?: string } | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Personal-token + apiEndpoint captured after successful login (+ MFA).
  const [personalToken, setPersonalToken] = useState<string | null>(null);
  const [apiEndpoint, setApiEndpoint] = useState<string | null>(null);

  const [check, setCheck] = useState<AppCheck | null>(null);
  const [finishing, setFinishing] = useState<"accept" | "refuse" | null>(null);

  // Persisted session (localStorage) — usable for this consent when it
  // belongs to the same platform. The user can always pick "Not me".
  const flowSvcInfoUrl =
    query.serviceInfoUrl ?? (query.pollUrl ? deriveServiceInfoUrlFromPollUrl(query.pollUrl) : null);
  const storedUsable =
    storedConnection !== null &&
    flowSvcInfoUrl !== null &&
    storedServiceInfoUrl() === flowSvcInfoUrl;
  const [knownUsername, setKnownUsername] = useState<string | null>(null);
  useEffect(() => {
    if (!storedUsable || !storedConnection) {
      setKnownUsername(null);
      return;
    }
    let cancelled = false;
    storedConnection
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
  }, [storedUsable, storedConnection]);

  async function continueAsStored() {
    if (!storedConnection) return;
    const conn = storedConnection as unknown as { token?: string; endpoint: string };
    if (!conn.token) {
      setConnection(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The consent-completion payload needs the username; the form was
      // skipped, so resolve it from the stored session.
      const asUser = knownUsername ?? (await storedConnection.username());
      setUsername(asUser);
      setPersonalToken(conn.token);
      setApiEndpoint(conn.endpoint);
      await runCheckApp(conn.endpoint, conn.token, asUser);
    } catch {
      // Stored token no longer valid (revoked/expired) — drop it and let the
      // user sign in normally.
      setConnection(null);
      setPersonalToken(null);
      setApiEndpoint(null);
      setError("Your previous session is no longer valid — please sign in.");
    } finally {
      setBusy(false);
    }
  }

  // Initial load: pull access state + service-info.
  useEffect(() => {
    if (!query.pollUrl) {
      setInitError(
        "Missing the `poll` query parameter — open this page through your application's `Service.setupAuth(...)` call rather than directly.",
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await loadAccessState(query.pollUrl!);
        if (cancelled) return;
        setAccessState(state);
        // Service-info comes from (in order) the access-state, the pryvServiceInfoUrl
        // query param, or a same-core derivation from the poll URL.
        let svcInfoUrl = query.serviceInfoUrl;
        if (!svcInfoUrl && !state.serviceInfo) {
          svcInfoUrl = deriveServiceInfoUrlFromPollUrl(query.pollUrl!);
        }
        if (state.serviceInfo) {
          setServiceInfo(state.serviceInfo as { register?: string; support?: string; api?: string });
        } else if (svcInfoUrl) {
          const r = await fetch(svcInfoUrl, { headers: { Accept: "application/json" } });
          if (cancelled) return;
          setServiceInfo(await r.json());
        }
        // If the state is already ACCEPTED (re-open), short-circuit through close_or_redirect.
        if (state.status === "ACCEPTED" || state.status === "REFUSED") {
          closeOrRedirect(query.pollUrl!, state, query.cli);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setInitError(err instanceof Error ? err.message : "Failed to load access state.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function makeService() {
    const svcInfoUrl = query.serviceInfoUrl ?? deriveServiceInfoUrlFromPollUrl(query.pollUrl!);
    return new Pryv.Service(svcInfoUrl ?? "");
  }

  async function runCheckApp(endpoint: string, token: string, asUser?: string) {
    if (!accessState) return;
    // != null (not !== undefined): the poll state carries explicit `null`s
    // for absent fields, and the check-app schema rejects e.g. clientData:null.
    const checkData = {
      requestingAppId: accessState.requestingAppId || APP_ID,
      requestedPermissions: accessState.requestedPermissions || [],
      ...(accessState.deviceName != null ? { deviceName: accessState.deviceName } : {}),
      ...(accessState.token != null ? { token: accessState.token } : {}),
      ...(accessState.expireAfter != null ? { expireAfter: accessState.expireAfter } : {}),
      ...(accessState.clientData != null ? { clientData: accessState.clientData } : {}),
    };
    const result = await checkAppAccess(endpoint, token, checkData);
    if (result.matchingAccess) {
      // Already authorized — short-circuit through close_or_redirect with the
      // existing access token.
      await finalizeAccepted(result.matchingAccess.token, endpoint, asUser);
      return;
    }
    setCheck(result);
  }

  async function finalizeAccepted(token: string, endpoint: string, asUser?: string) {
    if (!accessState || !query.pollUrl) return;
    const apiEp = buildApiEndpointWithToken(endpoint, token);
    const accepted: Partial<AccessState> = {
      status: "ACCEPTED",
      apiEndpoint: apiEp,
      username: asUser ?? username,
      token,
    };
    await updateAccessState(query.pollUrl, accepted);
    closeOrRedirect(query.pollUrl, { ...accessState, ...accepted }, query.cli);
  }

  async function accept() {
    if (!accessState || !apiEndpoint || !personalToken || !check) return;
    setFinishing("accept");
    setError(null);
    try {
      if (check.mismatchingAccess) {
        await deleteAppAccess(apiEndpoint, personalToken, check.mismatchingAccess.id);
      }
      const created = await createAppAccess(apiEndpoint, personalToken, {
        permissions: check.checkedPermissions || [],
        name: accessState.requestingAppId || APP_ID,
        type: "app",
        ...(accessState.deviceName != null ? { deviceName: accessState.deviceName } : {}),
        ...(accessState.token != null ? { token: accessState.token } : {}),
        ...(accessState.expireAfter != null ? { expireAfter: accessState.expireAfter } : {}),
        ...(accessState.clientData != null ? { clientData: accessState.clientData } : {}),
      });
      await finalizeAccepted(created.token, apiEndpoint);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not accept.");
    } finally {
      setFinishing(null);
    }
  }

  async function refuse() {
    if (!accessState || !query.pollUrl) return;
    setFinishing("refuse");
    setError(null);
    try {
      const refused: Partial<AccessState> = {
        status: "REFUSED",
        reasonId: "REFUSED_BY_USER",
        message: "The user refused to give access to the requested permissions",
      };
      try {
        await updateAccessState(query.pollUrl, refused);
      } catch {
        /* close anyway per legacy contract */
      }
      closeOrRedirect(query.pollUrl, { ...accessState, ...refused }, query.cli);
    } finally {
      setFinishing(null);
    }
  }

  if (initError) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Authorize access</h1>
        <Alert>{initError}</Alert>
      </Card>
    );
  }

  if (!accessState) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Authorize access</h1>
        <p className="text-sm text-muted">Loading access request…</p>
      </Card>
    );
  }

  // Permissions panel — visible after sign-in (+ MFA) when check-app returns
  // checkedPermissions and no matchingAccess short-circuited the flow. The
  // legacy grammar has no user-choice annotations: all entries render locked.
  if (check && check.checkedPermissions) {
    const entries = consentEntries(check.checkedPermissions as OfferPermission[]);
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          <strong>{accessState.requestingAppId}</strong>
        </h1>
        <p className="mb-2 text-sm">is requesting permission:</p>
        <PermissionList entries={entries} />
        {accessState.expireAfter != null && (
          <p className="mb-2 text-sm">
            <strong>Expires after:</strong> {accessState.expireAfter}s
          </p>
        )}
        {check.mismatchingAccess && (
          <Alert tone="info">
            A different access was already given to this app. Approving will replace it.
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
        <ConsentActions
          busy={finishing}
          onAccept={() => void accept()}
          onRefuse={() => void refuse()}
        />
      </Card>
    );
  }

  // Already signed in on this platform (persisted session): offer to
  // continue to the consent step directly, with an explicit way out so a
  // shared browser doesn't grant access under the wrong account.
  if (storedUsable && !personalToken) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">Welcome back</h1>
        <p className="mb-6 text-sm text-muted">
          You are signed in{knownUsername ? (
            <>
              {" "}as <strong>{knownUsername}</strong>
            </>
          ) : null}
          . Continue to review the access requested by{" "}
          <strong>{accessState.requestingAppId || "the requesting app"}</strong>?
        </p>
        {error && <Alert>{error}</Alert>}
        <Button type="button" onClick={() => void continueAsStored()} disabled={busy}>
          {busy ? "Checking…" : `Continue${knownUsername ? ` as ${knownUsername}` : ""}`}
        </Button>
        <button
          type="button"
          onClick={() => setConnection(null)}
          disabled={busy}
          className="mt-3 w-full rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          Not me — use another account
        </button>
        <Button variant="ghost" type="button" onClick={() => void refuse()} disabled={busy || finishing !== null} className="mt-3">
          Cancel
        </Button>
      </Card>
    );
  }

  // Shared sign-in gate (initial state).
  // Register / password-reset links need the platform's service-info URL;
  // same resolution order as makeService. They open in a new tab so this
  // popup keeps its pending access request (poll context) alive.
  const linksSvcInfoUrl = query.serviceInfoUrl ?? deriveServiceInfoUrlFromPollUrl(query.pollUrl!);
  const linksSearch = linksSvcInfoUrl
    ? `?pryvServiceInfoUrl=${encodeURIComponent(linksSvcInfoUrl)}`
    : "";
  return (
    <ConsentSignIn
      makeService={makeService}
      appId={APP_ID}
      prompt={
        <>
          Sign in to grant access to{" "}
          <strong>{accessState.requestingAppId || "the requesting app"}</strong>.
        </>
      }
      onSignedIn={async (s) => {
        // The MFA verify path may return a bare token without an endpoint —
        // fall back to the service-info api template.
        const endpoint =
          s.endpoint ??
          (serviceInfo?.api ? serviceInfo.api.replace("{username}", s.username) : "");
        setUsername(s.username);
        setPersonalToken(s.personalToken);
        setApiEndpoint(endpoint);
        // Persist the session so the next auth request (or /account visit)
        // skips the credentials — the pre-consent card offers "Not me" to
        // switch accounts instead.
        if (s.endpoint) {
          setConnection(s.connection as PryvConnection, flowSvcInfoUrl);
        }
        await runCheckApp(endpoint, s.personalToken, s.username);
      }}
      onCancel={() => void refuse()}
      cancelDisabled={finishing !== null}
      footer={
        <>
          <div className="mt-4 flex justify-between text-sm">
            <Link
              to={`/reset-password${linksSearch}`}
              target="_blank"
              className="text-primary hover:underline"
            >
              Forgot password?
            </Link>
            <Link
              to={`/register${linksSearch}`}
              target="_blank"
              className="text-primary hover:underline"
            >
              Create account
            </Link>
          </div>
          {serviceInfo?.support && (
            <p className="mt-6 text-sm text-muted">
              Questions? Visit our{" "}
              <a href={serviceInfo.support} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                helpdesk
              </a>
              .
            </p>
          )}
        </>
      }
    />
  );
}

/**
 * Build the token-embedded apiEndpoint string from a bare endpoint + token.
 * Legacy uses `https://{token}@host/{user}/` for subdomain platforms and
 * `https://{token}@host/{user}/` for dnsLess too (the token always prefixes
 * the host part as `Authorization`).
 */
function buildApiEndpointWithToken(endpoint: string, token: string): string {
  try {
    const u = new URL(endpoint);
    u.username = token;
    return u.toString();
  } catch {
    return endpoint;
  }
}
