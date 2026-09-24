import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Pryv from "pryv";
import { Card, Button, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { PermissionList } from "../components/consent/PermissionList";
import { ConsentActions } from "../components/consent/ConsentActions";
import {
  consentEntries,
  grantedPermissions,
  initialFlags,
  permissionKey,
  type OfferPermission,
} from "../lib/consent";
import { useSession, storedServiceInfoUrl, storedParentConnection, type PryvConnection } from "../lib/session";
import { accessRequestSearch } from "../lib/authParams";
import { isAllowedServiceInfoUrl, PLATFORM_NOT_ALLOWED } from "../lib/deployedSettings";
import { consentMessage } from "../lib/consentMessage";
import { MarkdownLite } from "../lib/markdownLite";
import { Delegation } from "@pryv/delegation";
import { runFlow, delegationErrorMessage } from "../lib/delegation";
import { isSessionRejected } from "../lib/sessionErrors";
import {
  offersTargets,
  grantTargets,
  preselectedTarget,
  unavailableActAs,
  delegationHint,
  isDelegatedChild,
  hintForAccess,
  openDelegatedWorkspace,
  markRequestDone,
  wasRequestDone,
  type GrantTarget,
  type DelegationHint,
} from "../lib/grantFor";
import {
  loadAccessState,
  updateAccessState,
  checkAppAccess,
  createAppAccess,
  deleteAppAccess,
  updateAppAccess,
  sameClientData,
  closeOrRedirect,
  deriveServiceInfoUrlFromPollUrl,
  buildAcceptedState,
  createHandoffSecret,
  type AccessState,
  type AccessStateUpdateResult,
  type Permission,
  type AppAccess,
  type AppCheck,
} from "../lib/accessFlow";

const APP_ID = "pryv-app-web-user-account";

/**
 * Whether a diverged access is updated in place (keeping its token, so
 * whoever holds it keeps a working credential) rather than replaced by
 * delete + create. Replaced when an update could not make it match:
 * - the app proposed its own token, and asked for THAT token;
 * - a delegation is involved on either side: the core stamps the delegation
 *   lineage only when an access is created, so an update would leave it
 *   wrong (unmarked, or still marked when the owner re-grants);
 * - its clientData differs: the core merges clientData on update, so stale
 *   keys would stay and the access would never match again.
 */
function updatesInPlace(
  mismatching: AppAccess | null | undefined,
  state: AccessState,
  delegationInvolved: boolean,
): boolean {
  return (
    mismatching != null &&
    state.token == null &&
    !delegationInvolved &&
    !isDelegatedChild(mismatching) &&
    sameClientData(mismatching.clientData, state.clientData)
  );
}

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
 * (or update a mismatching prior one in place) and POST the result back
 * to `pollUrl`; finally we either close the popup or redirect to
 * `returnURL` with the legacy `prYv*` params the lib-js consumer reads.
 *
 * Sign-in, permission render and Accept/Reject come from the shared
 * consent kit (`components/consent/`); this container keeps only the
 * legacy wire protocol (poll state, check-app, access creation).
 *
 * An access request may carry a consent form (the `consent` field of the
 * poll state, present when the app annotated its request and this server
 * understood it). With one, the list behaves exactly as the OAuth2 consent
 * screen does: required entries locked, opt-in entries opening unticked,
 * and only the ticked subset minted. Without one, the older grammar
 * applies and the whole list renders all-or-nothing.
 *
 * Mirrors app-web-auth3's `Authorization.vue` + `bits/Permissions.vue` +
 * `ops/{login,check_access,accept_access,refuse_access,close_or_redirect,
 * mfa_verify}` — same wire shape, same outcomes.
 */
export default function Auth() {
  const { search } = useLocation();
  const query = parseAuthQuery(search);
  const { connection: sessionConnection, setConnection, actingAs } = useSession();
  // While the account pages act for a controlled account, grant from the
  // session of the account acting: the selector then offers the controlled
  // account (preselected), and the app's actAs is honoured. The acting
  // session is never offered as if it were the user's own: without the
  // session to return to, the user signs in.
  const parentConnection = useMemo(
    () => (actingAs != null ? storedParentConnection() : null),
    [actingAs],
  );
  const storedConnection = actingAs != null ? parentConnection : sessionConnection;
  const actingPreselect = parentConnection != null ? actingAs?.username ?? null : null;

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

  // "Who is this for?": offered after sign-in when the platform runs account
  // delegation, the app allows it, and the user controls other accounts.
  // `owner` keeps the signed-in account's own credentials while it is open.
  const [targets, setTargets] = useState<GrantTarget[] | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [owner, setOwner] = useState<{
    username: string;
    endpoint: string;
    token: string;
    client: { getToken(u: string): Promise<{ token: string; apiEndpoint: string }> };
  } | null>(null);
  // Set when granting on a controlled account. `personalToken` then holds a
  // delegate token for that account: in memory only, never stored and never
  // made the session.
  const [grantFor, setGrantFor] = useState<DelegationHint | null>(null);
  // The request was decided in this tab and the server has since forgotten it.
  const [requestDone, setRequestDone] = useState(false);

  // The consent form, present only when the app sent a `consent` sidecar
  // AND this server understood it. Without one the legacy contract applies:
  // one locked list, accept or deny.
  const consentForm = accessState?.consent;
  const allowsChoice = consentForm?.allowUserChoice === true;

  // The rows to render. The annotations come from the consent form; the
  // display names come from check-app, which resolved them against the
  // account's real stream names. They are matched on what an entry GRANTS,
  // never on its name, which is the server's identity rule.
  const entries = useMemo(() => {
    const checked = (check?.checkedPermissions ?? []) as OfferPermission[];
    if (consentForm == null) return consentEntries(checked);
    const byKey = new Map(checked.map((p) => [permissionKey(p), p]));
    const annotated = (consentForm.permissions as OfferPermission[]).map((p) => {
      const resolved = byKey.get(permissionKey(p));
      return resolved == null ? p : { ...resolved, mandatory: p.mandatory, optIn: p.optIn };
    });
    return consentEntries(annotated, { allowUserChoice: allowsChoice });
  }, [check, consentForm, allowsChoice]);

  // Re-seeded whenever the rows change, because they arrive asynchronously
  // (check-app runs after sign-in), so a one-shot initializer would capture
  // an empty list and leave every optional entry unticked.
  const [grantedFlags, setGrantedFlags] = useState<boolean[]>([]);
  useEffect(() => {
    setGrantedFlags(initialFlags(entries));
  }, [entries]);

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
      await afterSignIn(conn.endpoint, conn.token, asUser, storedConnection);
    } catch (err: unknown) {
      setPersonalToken(null);
      setApiEndpoint(null);
      if (isSessionRejected(err)) {
        // Stored token no longer valid (revoked/expired): drop it and let the
        // user sign in normally.
        setConnection(null);
        setError("Your previous session is no longer valid — please sign in.");
      } else {
        // Network error or server failure: says nothing about the token.
        // Keep the session (and the account pages' state) so the user can retry.
        setError("Could not reach the server, please try again.");
      }
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
    // The platform the user will sign in to must be one this deployment
    // serves; checked before anything is fetched from the link.
    const linkSvcInfoUrl = query.serviceInfoUrl ?? deriveServiceInfoUrlFromPollUrl(query.pollUrl);
    // An undeterminable platform is refused too when the deployment restricts them.
    if (!isAllowedServiceInfoUrl(linkSvcInfoUrl ?? "")) {
      setInitError(PLATFORM_NOT_ALLOWED);
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
        // Reloaded after this tab decided the request and the server has
        // since forgotten it: that is completion, not an error.
        if ((err as { status?: number })?.status === 400 && wasRequestDone(query.pollUrl!)) {
          setRequestDone(true);
          return;
        }
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
    // The password goes to this platform: refuse one this deployment does not serve.
    if (!isAllowedServiceInfoUrl(svcInfoUrl ?? "")) throw new Error(PLATFORM_NOT_ALLOWED);
    return new Pryv.Service(svcInfoUrl ?? "");
  }

  /**
   * After sign-in: offer "who is this for?" when it applies, else go straight
   * to the consent step for the signed-in account.
   */
  async function afterSignIn(
    endpoint: string,
    token: string,
    asUser: string,
    connection: PryvConnection | null,
  ) {
    if (connection && accessState) {
      let info: unknown = null;
      try {
        info = await connection.service.info();
      } catch {
        info = null;
      }
      if (offersTargets(info as { features?: { delegation?: unknown } }, accessState.actAs)) {
        const client = Delegation.fromConnection(connection, { pryv: Pryv });
        const listed = await runFlow(() => client.listControlled());
        const choices = listed.ok ? grantTargets(asUser, listed.value) : [];
        if (choices.length > 1) {
          setOwner({ username: asUser, endpoint, token, client });
          setTargets(choices);
          setSelectedTarget(preselectedTarget(choices, accessState.actAs, actingPreselect).username);
          return;
        }
      }
    }
    await runCheckApp(endpoint, token, asUser);
  }

  /** Continue with the account picked in the selector. */
  async function continueWithTarget() {
    if (!owner || !targets) return;
    const target = targets.find((t) => t.username === selectedTarget) ?? targets[0];
    setBusy(true);
    setError(null);
    try {
      if (target.self) {
        setTargets(null);
        await runCheckApp(owner.endpoint, owner.token, owner.username);
        return;
      }
      const workspace = await openDelegatedWorkspace(owner.client, target.username);
      const hint = delegationHint(target.username, { username: owner.username });
      setUsername(workspace.username);
      setPersonalToken(workspace.token);
      setApiEndpoint(workspace.apiEndpoint);
      setGrantFor(hint);
      setTargets(null);
      await runCheckApp(workspace.apiEndpoint, workspace.token, workspace.username, hint);
    } catch (err: unknown) {
      setError(delegationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCheckApp(endpoint: string, token: string, asUser?: string, hint?: DelegationHint) {
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
      // Already authorized: short-circuit through close_or_redirect with the
      // existing access token. On a controlled account, the access is only
      // described as delegated when it was granted through the delegation.
      const reuseHint = hint != null
        ? (isDelegatedChild(result.matchingAccess) ? hint : undefined)
        : hintForAccess(result.matchingAccess, asUser ?? username);
      // `token` here is the signed-in personal token (runCheckApp's own param),
      // used to create the hand-off secret; finalizeAccepted skips shape H when
      // a delegation hint is posted, so a delegated reuse stays inline.
      const refusal = await finalizeAccepted(result.matchingAccess.token, endpoint, asUser, reuseHint, token);
      // Working on a controlled account: drop its delegate token once handed over.
      if (refusal == null && hint != null) setPersonalToken(null);
      if (refusal != null) {
        // The register refused this existing access, or could not verify it.
        // Say so rather than leaving the user on a page that looks stuck.
        // The access is NOT deleted here: it predates this request, so it is
        // not ours to remove.
        setError(consentRefusalMessage(refusal));
      }
      return;
    }
    setCheck(result);
  }

  /**
   * Post the ACCEPTED state and hand over. Returns the register's answer
   * when it refused, so the caller can undo what it minted; on success it
   * closes the flow and returns null.
   */
  async function finalizeAccepted(
    token: string,
    endpoint: string,
    asUser?: string,
    hint?: DelegationHint,
    creatorToken?: string | null,
  ): Promise<AccessStateUpdateResult | null> {
    if (!accessState || !query.pollUrl) return null;
    const apiEp = buildApiEndpointWithToken(endpoint, token);
    const acceptedUsername = asUser ?? username;

    // Shape H: when the request asked for shared-secret delivery, is not a
    // consent-form request (the server needs the token to verify the grant),
    // and is not a delegated grant (a delegation-derived token may not create
    // the hand-off secret), this page creates the one-time secret itself with
    // the personal token and posts only the key, so the token never reaches
    // the core that answered the request. Any create failure falls back to
    // inline delivery (shape L), which the server converts or delivers as-is.
    //
    // `creatorToken` is the personal token to create the secret with, passed
    // by the caller from its own scope — NOT read from React state, which the
    // sign-in entry points set in the same tick (a stale null there would
    // silently disable the hand-off on the already-authorized reuse path).
    let handoffKey: string | null = null;
    const wantsHandoff = accessState.credentialHandoff === "shared-secret";
    const canShapeH =
      wantsHandoff && accessState.consent == null && hint == null && creatorToken != null;
    if (canShapeH) {
      try {
        handoffKey = await createHandoffSecret(endpoint, creatorToken as string, {
          requestingAppId: accessState.requestingAppId ?? "app",
          secret: { username: acceptedUsername, token, apiEndpoint: apiEp },
        });
      } catch (e) {
        // Fall back to inline delivery, but leave a trace: a create that keeps
        // failing (e.g. shared secrets disabled) is worth seeing in the console.
        console.warn("credential hand-off secret creation failed; delivering inline", e);
        handoffKey = null;
      }
    }

    const accepted = buildAcceptedState({
      username: acceptedUsername,
      endpoint,
      token,
      apiEndpointWithToken: apiEp,
      handoffKey,
      delegation: hint ?? null,
    });
    let result = await updateAccessState(query.pollUrl, accepted);
    if (result.errorId === "consent-check-unavailable") {
      // The server could not verify the grant, which says nothing about the
      // access. Give it one more chance before treating this as a failure.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        result = await updateAccessState(query.pollUrl, accepted);
      } catch {
        // A retry that cannot even reach the register is still a refusal to
        // hand over: report it like one, so the caller cleans up the access
        // it minted rather than letting the throw skip that.
        result = { status: 503, errorId: "consent-check-unavailable", reason: "retry-failed" };
      }
    }
    if (result.status >= 400) return result;
    markRequestDone(query.pollUrl);
    // The delegate token has done its job: drop it before handing over.
    if (grantFor != null || hint != null) setPersonalToken(null);
    closeOrRedirect(query.pollUrl, { ...accessState, ...accepted }, query.cli);
    return null;
  }

  /** What to tell the user when the register refused the grant. */
  function consentRefusalMessage(result: AccessStateUpdateResult): string {
    if (result.errorId === "consent-check-unavailable") {
      return "This access could not be verified right now. Nothing was granted, please try again in a moment.";
    }
    switch (result.reason) {
      case "mandatory-refused":
        return "Some permissions this app requires were not granted. Tick the required entries, or refuse the request.";
      case "choice-not-allowed":
        return "This request must be accepted in full or refused.";
      case "empty-grant":
        return "Nothing was granted. Tick at least one permission, or refuse the request.";
      default:
        return "The access that was created does not match what this app requested. Please try again.";
    }
  }

  async function accept() {
    if (!accessState || !apiEndpoint || !personalToken || !check) return;
    setFinishing("accept");
    setError(null);
    try {
      // With a consent form the user's ticks decide what is minted; locked
      // rows are always in. Without one, the whole checked set is minted,
      // exactly as before.
      const permissions = (
        consentForm != null
          ? grantedPermissions(entries, grantedFlags)
          : check.checkedPermissions || []
      ) as Permission[];
      if (consentForm != null && permissions.length === 0) {
        // Granting nothing is a refusal; the server would say so anyway.
        setError("Tick at least one permission, or refuse the request.");
        setFinishing(null);
        return;
      }
      const mismatching = check.mismatchingAccess;
      const updateInPlace = updatesInPlace(mismatching, accessState, grantFor != null || actingAs != null);
      let access: AppAccess;
      if (mismatching != null && updateInPlace) {
        access = await updateAppAccess(apiEndpoint, personalToken, mismatching.id, {
          permissions,
          ...(accessState.deviceName != null ? { deviceName: accessState.deviceName } : {}),
          // Mirror the request: no expireAfter means no expiry.
          ...(accessState.expireAfter != null ? { expireAfter: accessState.expireAfter } : { expires: null }),
        });
      } else {
        if (mismatching != null) {
          await deleteAppAccess(apiEndpoint, personalToken, mismatching.id);
        }
        access = await createAppAccess(apiEndpoint, personalToken, {
          permissions,
          name: accessState.requestingAppId || APP_ID,
          type: "app",
          ...(accessState.deviceName != null ? { deviceName: accessState.deviceName } : {}),
          ...(accessState.token != null ? { token: accessState.token } : {}),
          ...(accessState.expireAfter != null ? { expireAfter: accessState.expireAfter } : {}),
          ...(accessState.clientData != null ? { clientData: accessState.clientData } : {}),
        });
      }
      // An access written with the delegate token carries the lineage
      // marker, so the hint is read from the access the server returned.
      // `personalToken` (guarded above) creates the hand-off secret on the
      // signed-in account; skipped for a delegated grant by the hint gate.
      const refusal = await finalizeAccepted(access.token, apiEndpoint, undefined, grantFor ?? hintForAccess(access, username), personalToken);
      if (refusal != null) {
        // A freshly created access was minted before the register was told,
        // so a refusal leaves one the app will never receive: remove it
        // rather than leave an orphan in the account's connected apps. An
        // updated access predates this request and is not ours to remove.
        if (!updateInPlace) {
          try {
            await deleteAppAccess(apiEndpoint, personalToken, access.id);
          } catch {
            /* the account can still revoke it from Connected apps */
          }
        }
        setError(consentRefusalMessage(refusal));
      }
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
        markRequestDone(query.pollUrl);
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

  if (requestDone) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">Authorize access</h1>
        <p className="text-sm">This request is complete. You can close this window.</p>
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

  // "Who is this for?": the signed-in account, or an account it controls.
  if (targets != null && owner != null) {
    const appName = accessState.requestingAppId || "the requesting app";
    const unavailable = unavailableActAs(targets, accessState.actAs);
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          Grant <strong>{appName}</strong> access to:
        </h1>
        {unavailable != null && (
          <Alert tone="info">
            <strong>{unavailable}</strong> is not an account you can act for; choose below.
          </Alert>
        )}
        <fieldset className="mb-4 space-y-2">
          <legend className="sr-only">Account to grant access to</legend>
          {targets.map((t) => (
            <label key={t.username} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="grant-target"
                value={t.username}
                checked={selectedTarget === t.username}
                onChange={() => setSelectedTarget(t.username)}
              />
              <strong>{t.username}</strong>
              <span className="text-muted">{t.self ? "(me)" : `(via ${owner.username})`}</span>
            </label>
          ))}
        </fieldset>
        {error && <Alert>{error}</Alert>}
        <Button type="button" onClick={() => void continueWithTarget()} disabled={busy}>
          {busy ? "Checking…" : `Continue for ${selectedTarget ?? owner.username}`}
        </Button>
        <Button variant="ghost" type="button" onClick={() => void refuse()} disabled={busy || finishing !== null} className="mt-3">
          Cancel
        </Button>
      </Card>
    );
  }

  // Permissions panel — visible after sign-in (+ MFA) when check-app returns
  // checkedPermissions and no matchingAccess short-circuited the flow.
  //
  // Two shapes meet here. Without a consent form the legacy grammar applies
  // and every entry renders locked (accept or deny the lot). With one, the
  // rows carry the app's annotations and behave exactly as on the OAuth2
  // screen: mandatory rows locked, opt-in rows open unticked.
  if (check && check.checkedPermissions) {
    const consentMsg = consentMessage(accessState.clientData);
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          <strong>{accessState.requestingAppId}</strong>
        </h1>
        <p className="mb-2 text-sm">is requesting permission:</p>
        {consentMsg != null && (
          // The app's own explanation comes before the technical breakdown.
          // Untrusted text: MarkdownLite builds React elements, never innerHTML.
          // Framed and captioned so the app's words never read as the platform's.
          <div className="mb-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">Message from the app</div>
            <div
              data-testid="consent-message"
              className="max-h-48 overflow-y-auto rounded border border-divider p-3 text-sm"
            >
              <MarkdownLite text={consentMsg} />
            </div>
          </div>
        )}
        <PermissionList
          entries={entries}
          flags={allowsChoice ? grantedFlags : undefined}
          onToggle={
            allowsChoice
              ? (i, checked) => setGrantedFlags(grantedFlags.map((f, j) => (j === i ? checked : f)))
              : undefined
          }
        />
        {allowsChoice && (
          <p className="mb-2 text-sm text-muted">
            Untick anything you would rather not share. Entries marked as required cannot be
            unticked.
          </p>
        )}
        {accessState.expireAfter != null && (
          <p className="mb-2 text-sm">
            <strong>Expires after:</strong> {accessState.expireAfter}s
          </p>
        )}
        {check.mismatchingAccess && (
          <Alert tone="info">
            A different access was already given to this app.{" "}
            {updatesInPlace(check.mismatchingAccess, accessState, grantFor != null || actingAs != null)
              ? "Approving will update it."
              : "Approving will replace it."}
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
  // popup keeps its pending access request (poll context) alive. The links
  // also carry that request, so a user who creates an account or resets a
  // password there comes back to this consent screen instead of landing on
  // the profile while the app keeps waiting.
  const linksSvcInfoUrl = query.serviceInfoUrl ?? deriveServiceInfoUrlFromPollUrl(query.pollUrl!);
  const linksParams = new URLSearchParams(accessRequestSearch(search));
  if (linksSvcInfoUrl && !linksParams.has("pryvServiceInfoUrl")) {
    linksParams.set("pryvServiceInfoUrl", linksSvcInfoUrl);
  }
  // toString(), not .size: URLSearchParams.size is missing on Safari 16.
  const linksQs = linksParams.toString();
  const linksSearch = linksQs ? "?" + linksQs : "";
  return (
    <ConsentSignIn
      makeService={makeService}
      appId={APP_ID}
      // A refusal raised on the already-authorized short-circuit lands here,
      // after check-app has answered but before any consent panel exists.
      // Without this the message would be set and never rendered.
      externalError={error}
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
        await afterSignIn(endpoint, s.personalToken, s.username, (s.connection as PryvConnection) ?? null);
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
