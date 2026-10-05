import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { Pryv, cmc, cmcErrorIds } from "../lib/pryvClient";
import { Card, Button, Alert } from "../components/ui";
import { ConsentSignIn } from "../components/consent/ConsentSignIn";
import { ConsentPanel } from "../components/consent/ConsentPanel";
import { CmcOfferBlock, type CmcOfferView } from "../components/consent/CmcOfferBlock";
import { tNodes } from "../components/consent/tNodes";
import {
  invitesOf,
  allDecided,
  declinedMandatory,
  acceptOrder,
  acceptedOutcome,
  boundedReason,
  readOfferRef,
  listGrants,
  givenConsentOf,
  settledDecisions,
  givenOutcome,
  REFUSED_MANDATORY_CONSENT,
  MANDATORY_CONSENT_FAILED,
  type CmcInviteOutcome,
  type GivenConsent,
  type GrantLike,
  type InviteDecision,
} from "../lib/cmcInvites";
import { inviteFailure, OFFER_UNREADABLE_KEY } from "../lib/cmcAccept";
import {
  consentEntries,
  grantedPermissions,
  initialFlags,
  permissionKey,
  withRequestedNames,
  type OfferPermission,
} from "../lib/consent";
import { useSession, storedServiceInfoUrl, storedParentConnection, type PryvConnection } from "../lib/session";
import { accessRequestSearch, parseAuthParams } from "../lib/authParams";
import { parseBackTo } from "../lib/backTo";
import { chainedHandoffPath } from "../lib/handoffReturn";
import { registeredAs } from "../lib/signInCompletion";
import { getAllowedPlatforms, platformNotAllowedMessage, PlatformNotAllowedError } from "../lib/deployedSettings";
import { resolvePollPlatform } from "../lib/pollPlatform";
import { consentMessage } from "../lib/consentMessage";
import { MarkdownLite } from "../lib/markdownLite";
import { useRequestingApp, useStreamLabels } from "../lib/useConsentDisplay";
import { Delegation } from "../lib/pryvClient";
import { runFlow, delegationErrorMessage, formatSince } from "../lib/delegation";
import { isSessionRejected } from "../lib/sessionErrors";
import { loggableError } from "../lib/apiError";
import { CreateManagedAccount, type CreatedAccount } from "../components/delegation/CreateManagedAccount";
import {
  offersTargets,
  grantStep,
  managedOnlyOf,
  offersCreation as offersCreationFor,
  creationPrefill,
  MANAGED_ACCOUNT_UNAVAILABLE,
  unavailableActAs,
  delegationHint,
  isDelegatedChild,
  hintForAccess,
  openDelegatedWorkspace,
  markRequestDone,
  wasRequestDone,
  type GrantTarget,
  type DelegationHint,
  type ManagedUnavailableCause,
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
  /** Sign-in hint (`username`), as `/signin` reads it. */
  username: string | null;
}

/** Longest wait for the stored session's name before a hinted page shows the form. */
const KNOWN_USERNAME_WAIT_MS = 4000;

/** One consent invite block: its offer as read, and where its accept belongs. */
interface InviteView {
  offer: CmcOfferView | null;
  loading: boolean;
  /** Why the invite cannot be approved here (unreadable link, no scope); Decline stays available. */
  error: string | null;
  scope: string | null;
  /** The live grant this account already holds for the offer: shown as given, nothing to decide. */
  given: GivenConsent | null;
}

/** An access the app already holds, kept as it is when the request carries consent invites. */
interface ReusedAccess {
  access: AppAccess;
  endpoint: string;
  /** The signed-in token, to create the hand-off secret with (see finalizeAccepted). */
  creatorToken: string;
  asUser?: string;
  hint?: DelegationHint;
  /** Granted on a controlled account: drop the delegate token once handed over. */
  delegated: boolean;
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
    username: parseAuthParams(search).username,
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
 * A request carrying a page-only `next` (a hand-off page such as
 * `/cmc-accept?…`, see `chainedHandoffPath`) continues to it in this window
 * after an accept, when there is no `returnURL` and not in CLI mode.
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
 * An access request may also carry consent invites (`cmcInvites`, see
 * `lib/cmcInvites`): after check-app, each invite is shown as its own offer
 * block with its own Approve / Decline, under the app access, and the page's
 * Accept becomes "Continue", enabled once every invite is decided. Continue
 * then decides, accepts, grants, in that order: every declined invite that can
 * be answered gets a refusal (best-effort); a declined mandatory invite then
 * refuses the request before anything else is written; the approved invites are
 * accepted (with the person's own token, or the delegate token for `target`);
 * a failed mandatory accept refuses the request (a completion timeout is
 * reported, not refused); only then is the app access
 * created, and ACCEPTED carries one outcome per invite.
 *
 * Mirrors app-web-auth3's `Authorization.vue` + `bits/Permissions.vue` +
 * `ops/{login,check_access,accept_access,refuse_access,close_or_redirect,
 * mfa_verify}` — same wire shape, same outcomes.
 */
export default function Auth() {
  const { t } = useTranslation();
  const location = useLocation();
  const { search } = location;
  const navigate = useNavigate();
  const query = useMemo(() => parseAuthQuery(search), [search]);
  // Reached right after creating (and signing in) an account in this window:
  // the stored session is that account, so the request continues with it
  // without the "Welcome back" card meant for a returning visitor. Read once,
  // then cleared from the history entry, so a reload shows the card again.
  const [justRegistered] = useState(() => registeredAs(location.state));
  // "waiting" until the request and the stored session are known, "running"
  // while it continues, "off" otherwise (the card then shows as usual).
  const [autoContinue, setAutoContinue] = useState<"waiting" | "running" | "off">(
    justRegistered != null ? "waiting" : "off",
  );
  useEffect(() => {
    if (registeredAs(location.state) != null) {
      navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // A deployment restricted to some platforms handles a request only when BOTH
  // the poll URL and the link's service-info param belong to an allowed one.
  // The poll URL matters on its own: the page loads the request from it and
  // posts the granted token back to it, so an allowed service-info next to
  // someone else's poll URL would hand them the token. `platform` is the
  // allowed platform it resolved to (see lib/pollPlatform), null until then;
  // nothing is loaded from the link, and no password sent, before it is set.
  const restricted = getAllowedPlatforms() != null;
  const [platform, setPlatform] = useState<{ serviceInfoUrl: string } | null>(null);
  // The platform's service-info URL, for sign-in, links and display.
  const svcInfoUrlForFlow = restricted
    ? platform?.serviceInfoUrl ?? null
    : query.serviceInfoUrl ?? (query.pollUrl ? deriveServiceInfoUrlFromPollUrl(query.pollUrl) : null);

  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Personal-token + apiEndpoint captured after successful login (+ MFA).
  const [personalToken, setPersonalToken] = useState<string | null>(null);
  const [apiEndpoint, setApiEndpoint] = useState<string | null>(null);

  const [check, setCheck] = useState<AppCheck | null>(null);
  const [finishing, setFinishing] = useState<"accept" | "refuse" | null>(null);

  // Consent invites of the request (null without any): one offer block each,
  // read once the consent step is reached, decided before anything is written.
  const invites = useMemo(() => invitesOf(accessState), [accessState]);
  const [inviteViews, setInviteViews] = useState<InviteView[]>([]);
  const [inviteDecisions, setInviteDecisions] = useState<Array<InviteDecision | null>>([]);
  // With invites, an access the app already holds does not end the flow on
  // its own (the invites still need an answer): it is kept and handed over
  // after them.
  const [reuse, setReuse] = useState<ReusedAccess | null>(null);
  // The decisions as they stand (see `settledDecisions`): what Continue and the flow go by.
  const decisions = settledDecisions(inviteDecisions, inviteViews);

  // "Who is this for?": offered after sign-in when the platform runs account
  // delegation, the app allows it, and the user controls other accounts (or,
  // when the app named `actAs`, even without one: the step then offers to
  // create an account for someone the user looks after).
  // `owner` keeps the signed-in account's own credentials while it is open:
  // its connection and delegation client are the user's OWN session, never a
  // delegate token.
  const [targets, setTargets] = useState<GrantTarget[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [owner, setOwner] = useState<{
    username: string;
    endpoint: string;
    token: string;
    connection: PryvConnection;
    client: Delegation;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);
  // The app asked for an account the user manages (`actAsManagedOnly`): the
  // signed-in account is never offered, and when no managed account can be
  // used the page says why and offers Cancel only.
  const managedOnly = managedOnlyOf(accessState);
  const [managedUnavailable, setManagedUnavailable] = useState<ManagedUnavailableCause | null>(null);
  // Set when granting on a controlled account. `personalToken` then holds a
  // delegate token for that account: in memory only, never stored and never
  // made the session.
  const [grantFor, setGrantFor] = useState<DelegationHint | null>(null);
  // The request was decided in this tab and the server has since forgotten it,
  // or it was decided and the window could not be closed.
  const [requestDone, setRequestDone] = useState(false);
  // After the decision: a tab the page cannot close goes back to the app when
  // it gave a way back (`backUrl`), else shows the complete card.
  const closeFallback = { backUrl: parseBackTo(search).url, onStillOpen: () => setRequestDone(true), next: null };
  // Once the access is granted, a request with a hand-off page (`next`, a
  // consent offer) continues to it in this window instead of closing. Accept
  // only: Cancel and Reject end the flow, and a decided request re-opened does
  // not start the next step again.
  const acceptFallback = { ...closeFallback, next: inAppHref(chainedHandoffPath(search)) };

  // The consent form, present only when the app sent a `consent` sidecar
  // AND this server understood it. Without one the legacy contract applies:
  // one locked list, accept or deny.
  const consentForm = accessState?.consent;
  const allowsChoice = consentForm?.allowUserChoice === true;

  const flowSvcInfoUrl = svcInfoUrlForFlow;
  // The operator's catalog is the only source of a display name for the app:
  // the request's own id is shown when the catalog does not know it, never a
  // name the app supplied about itself.
  const requestingApp = useRequestingApp(accessState?.requestingAppId, flowSvcInfoUrl);
  const labelFor = useStreamLabels(flowSvcInfoUrl);

  // The rows to render. The annotations come from the consent form; the
  // display names come from check-app, which resolved them against the
  // account's real stream names. They are matched on what an entry GRANTS,
  // never on its name, which is the server's identity rule.
  const rowPermissions = useMemo(() => {
    const checked = (check?.checkedPermissions ?? []) as OfferPermission[];
    if (consentForm == null) return checked;
    const byKey = new Map(checked.map((p) => [permissionKey(p), p]));
    return (consentForm.permissions as OfferPermission[]).map((p) => {
      const resolved = byKey.get(permissionKey(p));
      return resolved == null ? p : { ...resolved, mandatory: p.mandatory, optIn: p.optIn };
    });
  }, [check, consentForm]);
  // What each row grants and whether it is locked: the identity of the rows.
  const rows = useMemo(
    () => consentEntries(rowPermissions, { allowUserChoice: consentForm != null && allowsChoice }),
    [rowPermissions, consentForm, allowsChoice],
  );
  // The same rows, in the same order, with display labels (which may arrive
  // later from the deployment's stream-label loader).
  const entries = useMemo(
    () => consentEntries(rowPermissions, { allowUserChoice: consentForm != null && allowsChoice, labelFor }),
    [rowPermissions, consentForm, allowsChoice, labelFor],
  );

  // Re-seeded whenever the ROWS change, because they arrive asynchronously
  // (check-app runs after sign-in), so a one-shot initializer would capture
  // an empty list and leave every optional entry unticked. Keyed on `rows`,
  // not `entries`: a label arriving late must never reset the user's choices.
  const [grantedFlags, setGrantedFlags] = useState<boolean[]>([]);
  useEffect(() => {
    setGrantedFlags(initialFlags(rows));
  }, [rows]);

  // The invites' offers, read once the consent step is reached (after the
  // platform check and the sign-in), through each capability, as
  // `/cmc-accept` reads its one offer. An offer this account already accepted
  // (a live grant minted from it, on the account the invite applies to) is
  // shown as given, with nothing to decide; when that cannot be checked, the
  // invite is shown as usual.
  const consentStepReached = check?.checkedPermissions != null;
  useEffect(() => {
    if (invites == null || !consentStepReached) return;
    let cancelled = false;
    setInviteDecisions(invites.map(() => null));
    setInviteViews(
      invites.map((inv) =>
        inv.capabilityUrl === ""
          ? { offer: null, loading: false, error: t(OFFER_UNREADABLE_KEY), scope: null, given: null }
          : { offer: null, loading: true, error: null, scope: null, given: null },
      ),
    );
    const settle = (i: number, view: InviteView) => {
      if (cancelled) return;
      setInviteViews((prev) => prev.map((v, j) => (j === i ? view : v)));
    };
    // One listing per account (token-bearing endpoint), shared by its invites.
    const listings = new Map<string, Promise<GrantLike[]>>();
    const givenFor = async (i: number, offerEventId: string | null): Promise<GivenConsent | null> => {
      const { credentials } = inviteCredentials(i);
      if (offerEventId == null || credentials == null) return null;
      const api = buildApiEndpointWithToken(credentials.endpoint, credentials.token);
      let listing = listings.get(api);
      if (listing == null) {
        listing = listGrants(api);
        listings.set(api, listing);
      }
      try {
        return givenConsentOf(await listing, offerEventId);
      } catch (err: unknown) {
        console.warn("auth: could not check whether a consent invite was already given:", loggableError(err));
        return null;
      }
    };
    invites.forEach((inv, i) => {
      if (inv.capabilityUrl === "") return;
      Promise.all([cmc.readOffer(inv.capabilityUrl), readOfferRef(inv.capabilityUrl)])
        .then(async ([offer, ref]) => {
          const given = await givenFor(i, ref.offerEventId);
          if (given != null && !cancelled) {
            setInviteDecisions((prev) => prev.map((d, j) => (j === i ? "given" : d)));
          }
          settle(i, {
            offer: offer as CmcOfferView,
            loading: false,
            error: given == null && ref.scope == null ? t("cmc.inviteNoScope") : null,
            scope: ref.scope,
            given,
          });
        })
        .catch((err: unknown) => {
          console.warn("auth: could not read a consent invite's offer:", loggableError(err));
          settle(i, { offer: null, loading: false, error: t(OFFER_UNREADABLE_KEY), scope: null, given: null });
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invites, consentStepReached]);

  // Persisted session (localStorage) — usable for this consent when it
  // belongs to the same platform. The user can always pick "Not me".
  const storedUsable =
    storedConnection !== null &&
    flowSvcInfoUrl !== null &&
    storedServiceInfoUrl() === flowSvcInfoUrl;
  const [knownUsername, setKnownUsername] = useState<string | null>(null);
  // Whether `knownUsername` has been looked up (resolved or failed).
  const [knownResolved, setKnownResolved] = useState(false);
  useEffect(() => {
    if (!storedUsable || !storedConnection) {
      setKnownUsername(null);
      setKnownResolved(true);
      return;
    }
    let cancelled = false;
    setKnownResolved(false);
    // The lookup is a network call: do not hold a hinted page on the loading
    // card for longer than this (the form comes first meanwhile; the
    // secondary "Continue as" appears if the name arrives later).
    const giveUp = setTimeout(() => {
      if (!cancelled) setKnownResolved(true);
    }, KNOWN_USERNAME_WAIT_MS);
    storedConnection
      .username()
      .then((u) => {
        if (!cancelled) setKnownUsername(u);
      })
      .catch(() => {
        if (!cancelled) setKnownUsername(null);
      })
      .finally(() => {
        clearTimeout(giveUp);
        if (!cancelled) setKnownResolved(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, [storedUsable, storedConnection]);
  // After a registration in this window: continue as the card's button would,
  // once the request is loaded (and, on a restricted deployment, its platform
  // resolved, which happens first). Without a usable session (or for a request
  // already decided) there is nothing to continue: the page shows as usual.
  useEffect(() => {
    if (autoContinue !== "waiting" || accessState == null || justRegistered == null) return;
    if (!storedUsable || requestDone || accessState.status === "ACCEPTED" || accessState.status === "REFUSED") {
      setAutoContinue("off");
      return;
    }
    setAutoContinue("running");
    void continueAsStored(justRegistered).finally(() => setAutoContinue("off"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, accessState, storedUsable, requestDone]);

  // The app named who should sign in (`username` hint). When a stored session
  // belongs to someone else, the sign-in form (pre-filled with the hint) comes
  // first and that session becomes a secondary "Continue as X instead". An
  // email hint never matches a username: it lands in the form and is resolved
  // on submit. The hint never clears the stored session. When the stored
  // session's name cannot be looked up (offline, revoked token), the form comes
  // first and no secondary action is offered: there is no name to show.
  const usernameHint = query.username;
  const hintDiffers =
    usernameHint != null &&
    storedUsable &&
    knownResolved &&
    usernameHint.toLowerCase() !== (knownUsername ?? "").toLowerCase();

  /**
   * Continue with the stored session. With `expected` (the account just
   * created in this window), only when the session is that account: otherwise
   * nothing happens and the card is shown.
   */
  async function continueAsStored(expected?: string) {
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
      if (expected != null && asUser.toLowerCase() !== expected.toLowerCase()) {
        console.warn("auth: the stored session is not the account just created; showing the sign-in card");
        return;
      }
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
        setError(t("consent.errorSessionInvalid"));
      } else {
        // Network error or server failure: says nothing about the token.
        // Keep the session (and the account pages' state) so the user can retry.
        setError(t("consent.errorUnreachable"));
      }
    } finally {
      setBusy(false);
    }
  }

  // Initial load: pull access state + service-info.
  useEffect(() => {
    if (!query.pollUrl) {
      setInitError(t("consent.errorMissingPoll"));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // Checked before anything is fetched from the link.
        let trustedInfo: { register?: string; support?: string; api?: string } | null = null;
        if (restricted) {
          const resolved = await resolvePollPlatform(query.pollUrl!, query.serviceInfoUrl);
          if (cancelled) return;
          if (!resolved) {
            setInitError(platformNotAllowedMessage());
            return;
          }
          setPlatform({ serviceInfoUrl: resolved.serviceInfoUrl });
          trustedInfo = resolved.serviceInfo;
        }
        const state = await loadAccessState(query.pollUrl!);
        if (cancelled) return;
        setAccessState(state);
        // Service-info comes from (in order) the allowed platform's own (restricted
        // deployments), the access-state, the pryvServiceInfoUrl query param, or a
        // same-core derivation from the poll URL.
        let svcInfoUrl = query.serviceInfoUrl;
        if (!svcInfoUrl && !state.serviceInfo) {
          svcInfoUrl = deriveServiceInfoUrlFromPollUrl(query.pollUrl!);
        }
        if (trustedInfo) {
          setServiceInfo(trustedInfo);
        } else if (state.serviceInfo) {
          setServiceInfo(state.serviceInfo as { register?: string; support?: string; api?: string });
        } else if (svcInfoUrl) {
          const r = await fetch(svcInfoUrl, { headers: { Accept: "application/json" } });
          if (cancelled) return;
          setServiceInfo(await r.json());
        }
        // If the state is already ACCEPTED (re-open), short-circuit through close_or_redirect.
        if (state.status === "ACCEPTED" || state.status === "REFUSED") {
          closeOrRedirect(query.pollUrl!, state, query.cli, closeFallback);
          // Show the complete card at once rather than the sign-in form
          // while the window closes or goes back.
          setRequestDone(true);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // Reloaded after this tab decided the request and the server has
        // since forgotten it: that is completion, not an error.
        if ((err as { status?: number })?.status === 400 && wasRequestDone(query.pollUrl!)) {
          setRequestDone(true);
          return;
        }
        setInitError(err instanceof Error ? err.message : t("consent.errorLoadState"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function makeService() {
    // The password goes to this platform: refuse one this deployment does not serve.
    if (restricted && platform == null) throw new PlatformNotAllowedError();
    return new Pryv.Service(svcInfoUrlForFlow ?? "");
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
    if (!accessState) return;
    // Whether the step applies (null: the platform's info could not be read),
    // and the accounts the user controls (null: not listed, or the listing failed).
    let offers: boolean | null = null;
    let listed: Awaited<ReturnType<Delegation["listControlled"]>> | null = null;
    let client: Delegation | null = null;
    if (connection) {
      let info: unknown = null;
      try {
        info = await connection.service.info();
      } catch {
        info = null;
      }
      offers = info == null ? null : offersTargets(info as { features?: { delegation?: unknown } }, accessState.actAs);
      if (offers) {
        client = Delegation.fromConnection(connection, { pryv: Pryv });
        const result = await runFlow(() => client!.listControlled());
        listed = result.ok ? result.value : null;
      }
    }
    // See `grantStep`: a failed listing still offers the creation when the app
    // named `actAs` and says why the managed accounts are missing; a single
    // choice (the user's own account) is still shown for that offer; with
    // `managedOnly` the signed-in account is never the answer.
    const step = grantStep({
      offers,
      listed,
      selfUsername: asUser,
      actAs: accessState.actAs,
      managedOnly,
      acting: actingAs != null,
      preferred: actingPreselect,
    });
    if (step.kind === "unavailable") {
      setManagedUnavailable(step.cause);
      return;
    }
    if (step.kind === "choose" && connection && client) {
      setOwner({ username: asUser, endpoint, token, connection, client });
      setListFailed(step.listFailed);
      setTargets(step.targets);
      setSelectedTarget(step.selected);
      // The app named an account the user does not manage yet (or, for a
      // managed account, there is none): the creation form opens at once.
      setCreateOpen(step.createOpen);
      setCreatedNotice(null);
      return;
    }
    // Never the signed-in account when the app asked for a managed one, whatever
    // the step above concluded.
    if (managedOnly) {
      setManagedUnavailable("list-failed");
      return;
    }
    await runCheckApp(endpoint, token, asUser);
  }

  /**
   * An account created from the step (with the user's own session): it is
   * active at birth, so it joins the choices, selected. Nothing continues on
   * its own: the user sees what was created, then presses "Continue for …".
   */
  function onManagedCreated(created: CreatedAccount) {
    setTargets((prev) => {
      if (prev == null) return prev;
      if (prev.some((c) => c.username === created.username)) return prev;
      const added: GrantTarget = { username: created.username, self: false };
      if (created.hostSlug) added.hostSlug = created.hostSlug;
      return [...prev, added];
    });
    setSelectedTarget(created.username);
    setCreateOpen(false);
    setCreatedNotice(t("consent.createManagedCreated", { username: created.username }));
  }

  /** Continue with the account picked in the selector. */
  async function continueWithTarget() {
    if (!owner || !targets) return;
    // With `managedOnly` nothing is granted until a managed account is chosen.
    const target = targets.find((c) => c.username === selectedTarget) ?? (managedOnly ? null : targets[0]);
    if (target == null || (managedOnly && target.self)) return;
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
      if (invitesOf(accessState) != null) {
        // The invites still need an answer: show them next to the access the
        // app already holds, and hand that access over after them.
        setReuse({
          access: result.matchingAccess,
          endpoint,
          creatorToken: token,
          asUser,
          hint: reuseHint,
          delegated: hint != null,
        });
        setCheck({ ...result, checkedPermissions: result.matchingAccess.permissions ?? [] });
        return;
      }
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
    inviteOutcomes?: CmcInviteOutcome[] | null,
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
        console.warn("credential hand-off secret creation failed; delivering inline:", loggableError(e));
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
    // One outcome per consent invite, only when the request carried some.
    if (inviteOutcomes != null) accepted.cmcInvites = inviteOutcomes;
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
    closeOrRedirect(query.pollUrl, { ...accessState, ...accepted }, query.cli, acceptFallback);
    return null;
  }

  /** What to tell the user when the register refused the grant. */
  function consentRefusalMessage(result: AccessStateUpdateResult): string {
    if (result.errorId === "consent-check-unavailable") {
      return t("consent.refusalUnverified");
    }
    switch (result.reason) {
      case "mandatory-refused":
        return t("consent.refusalMandatory");
      case "choice-not-allowed":
        return t("consent.refusalChoiceNotAllowed");
      case "empty-grant":
        return t("consent.refusalEmptyGrant");
      default:
        return t("consent.refusalMismatch");
    }
  }

  /**
   * Accept the approved consent invites, mandatory ones first, and return one
   * outcome per invite in the request's order. A mandatory invite that cannot
   * be accepted refuses the request instead: returns null, nothing granted.
   * `for: 'target'` invites are accepted on the account the access is granted
   * for, with the delegate token; without such an account, with the person's
   * own token, and the outcome says so.
   */
  /**
   * The credentials an invite is answered with: `for: 'target'` with the
   * delegate token on the account the access is granted for, when there is
   * one; otherwise the person's own (the owner's while granting for a
   * controlled account, since `personalToken` then holds the delegate token).
   * `asTarget` says whether the target account was used.
   */
  function inviteCredentials(i: number): { credentials: { endpoint: string; token: string } | null; asTarget: boolean } {
    if (invites == null || !apiEndpoint || !personalToken) return { credentials: null, asTarget: false };
    const own = grantFor != null
      ? (owner != null ? { endpoint: owner.endpoint, token: owner.token } : null)
      : { endpoint: apiEndpoint, token: personalToken };
    const asTarget = invitesAsTarget(i);
    return { credentials: asTarget ? { endpoint: apiEndpoint, token: personalToken } : own, asTarget };
  }

  /** Whether invite `i` applies to the account the access is granted for (a controlled one), see `inviteCredentials`. */
  function invitesAsTarget(i: number): boolean {
    return invites != null && invites[i].for === "target" && grantFor != null;
  }

  /**
   * Whose consent invite `i` is, by the same rule as `inviteCredentials`;
   * said only when the request went through "who is this for?" (without that
   * step every invite is the signed-in account's).
   */
  function inviteAccountLabel(i: number): string | null {
    if (owner == null) return null;
    return invitesAsTarget(i)
      ? t("cmc.inviteForManaged", { username })
      : t("cmc.inviteForSelf", { username: owner.username });
  }

  /**
   * Answer every declined invite that can be answered (offer read, scope
   * known) with a refusal, as `/cmc-accept`'s Decline does, so the requester
   * is told rather than left waiting. Best-effort: a refusal that cannot be
   * sent is logged, and the outcome stays `{ declined: true }`.
   */
  async function refuseDeclinedInvites(): Promise<void> {
    if (invites == null) return;
    for (let i = 0; i < invites.length; i++) {
      if (decisions[i] !== "decline") continue;
      const scope = inviteViews[i]?.scope;
      const { credentials } = inviteCredentials(i);
      // Unreadable or without a scope: nothing to answer with.
      if (scope == null || credentials == null) continue;
      try {
        const conn = new Pryv.Connection(buildApiEndpointWithToken(credentials.endpoint, credentials.token));
        await cmc.refuseInvite(conn, invites[i].capabilityUrl, { scopeStreamId: scope });
      } catch (err: unknown) {
        console.warn("auth: could not send a consent invite's refusal:", loggableError(err));
      }
    }
  }

  async function acceptInvites(): Promise<CmcInviteOutcome[] | null> {
    // Unreachable (accept() checks the same), but an empty list would be
    // refused by the core: take the refusal path rather than post it.
    if (invites == null || !apiEndpoint || !personalToken) return null;
    // A consent already given is reported from the grant in place; nothing is written.
    const outcomes: Array<CmcInviteOutcome | null> = invites.map((invite, i) => {
      if (decisions[i] === "decline") return { declined: true };
      const given = decisions[i] === "given" ? inviteViews[i]?.given : null;
      return given != null ? givenOutcome(given, invite.for === "target" && !invitesAsTarget(i)) : null;
    });
    const order = acceptOrder(invites, decisions);
    // Every invite must end with an outcome: one that is neither declined,
    // given nor to be accepted stops the flow before anything is written.
    if (outcomes.some((o, i) => o == null && !order.includes(i))) throw new Error(t("consent.errorCouldNotAccept"));
    // Declined invites are answered first, before any accept or grant.
    await refuseDeclinedInvites();
    for (const i of order) {
      const invite = invites[i];
      const { credentials, asTarget } = inviteCredentials(i);
      try {
        const scope = inviteViews[i]?.scope;
        if (credentials == null || scope == null) throw new Error("cmc-invite-not-acceptable");
        const conn = new Pryv.Connection(buildApiEndpointWithToken(credentials.endpoint, credentials.token));
        // The grant's name on the accepting account, when the request gave one (as `/cmc-accept` does).
        const res = await cmc.acceptInvite(conn, invite.capabilityUrl, {
          scopeStreamId: scope,
          ...(invite.accessName != null ? { accessName: invite.accessName } : {}),
        });
        outcomes[i] = acceptedOutcome(res, invite.for === "target" && !asTarget);
      } catch (err: unknown) {
        const failure = inviteFailure(err, t("cmc.errorCouldNotApprove"));
        // A wait that ended before the platform recorded the outcome is not a
        // failure: the accept usually completes moments later. Reported, and
        // the requester learns the truth from its inbox.
        if (invite.mandatory && failure.reason !== cmcErrorIds.CAPABILITY_TIMEOUT) {
          setError(t("consent.inviteMandatoryFailed", { reason: failure.message }));
          await refuseWith(
            MANDATORY_CONSENT_FAILED,
            "A consent invite the app marked as mandatory could not be accepted (invite " +
              (i + 1) + ": " + boundedReason(failure.reason) + ")",
          );
          return null;
        }
        outcomes[i] = { reason: boundedReason(failure.reason) };
      }
    }
    const answered = outcomes.filter((o): o is CmcInviteOutcome => o != null);
    if (answered.length !== invites.length) throw new Error(t("consent.errorCouldNotAccept"));
    return answered;
  }

  async function accept() {
    if (!accessState || !apiEndpoint || !personalToken || !check) return;
    if (invites != null && !allDecided(decisions, invites.length)) return;
    setFinishing("accept");
    setError(null);
    // Once the outcome is handed over, the buttons stay disabled: the window
    // is closing, going back to the app, or about to show the complete card.
    let handedOver = false;
    try {
      // Decide: a declined mandatory invite refuses the whole request before
      // anything is written (no invite accepted, no access created).
      if (invites != null && declinedMandatory(invites, decisions) >= 0) {
        // Every declined requester is told no; nothing is accepted or granted.
        await refuseDeclinedInvites();
        await refuseWith(
          REFUSED_MANDATORY_CONSENT,
          "The user declined a consent invite the app marked as mandatory",
        );
        handedOver = true;
        return;
      }
      // With a consent form the user's ticks decide what is minted; locked
      // rows are always in. Without one, the whole checked set is minted,
      // exactly as before.
      const permissions = (
        consentForm != null
          ? grantedPermissions(entries, grantedFlags)
          : check.checkedPermissions || []
      ) as Permission[];
      if (reuse == null && consentForm != null && permissions.length === 0) {
        // Granting nothing is a refusal; the server would say so anyway.
        setError(t("consent.errorTickOne"));
        setFinishing(null);
        return;
      }
      // Accept: every approved invite, before the app access is written.
      let inviteOutcomes: CmcInviteOutcome[] | null = null;
      if (invites != null) {
        inviteOutcomes = await acceptInvites();
        if (inviteOutcomes == null) {
          handedOver = true;
          return;
        }
      }
      // Grant: the access the app already holds is handed over as it is.
      if (reuse != null) {
        const refusal = await finalizeAccepted(
          reuse.access.token, reuse.endpoint, reuse.asUser, reuse.hint, reuse.creatorToken, inviteOutcomes,
        );
        handedOver = refusal == null;
        if (refusal == null && reuse.delegated) setPersonalToken(null);
        // Not deleted on a refusal: it predates this request.
        if (refusal != null) setError(consentRefusalMessage(refusal));
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
      const refusal = await finalizeAccepted(
        access.token, apiEndpoint, undefined, grantFor ?? hintForAccess(access, username), personalToken, inviteOutcomes,
      );
      handedOver = refusal == null;
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
      setError(err instanceof Error ? err.message : t("consent.errorCouldNotAccept"));
    } finally {
      if (!handedOver) setFinishing(null);
    }
  }

  async function refuse() {
    if (!accessState || !query.pollUrl) return;
    setFinishing("refuse");
    setError(null);
    await refuseWith("REFUSED_BY_USER", "The user refused to give access to the requested permissions");
  }

  /** Cancel when the app needs a managed account and none can be used: REFUSED, naming the cause. */
  async function refuseManagedUnavailable(cause: ManagedUnavailableCause) {
    if (!accessState || !query.pollUrl) return;
    setFinishing("refuse");
    setError(null);
    const why: Record<ManagedUnavailableCause, string> = {
      "delegation-off": "acting for another account is not available on this platform",
      "info-unreadable": "the platform's information could not be read",
      "list-failed": "the accounts the user manages could not be listed",
      none: "the user manages no active account, and none can be created from this session",
    };
    await refuseWith(MANAGED_ACCOUNT_UNAVAILABLE, "The app asked for an account the user manages, and none can be used: " + why[cause]);
  }

  /** Post REFUSED with this reason and hand over (close, go back, or the complete card). */
  async function refuseWith(reasonId: string, message: string) {
    if (!accessState || !query.pollUrl) return;
    const refused: Partial<AccessState> = {
      status: "REFUSED",
      reasonId,
      message,
    };
    try {
      await updateAccessState(query.pollUrl, refused);
      markRequestDone(query.pollUrl);
    } catch {
      /* close anyway per legacy contract */
    }
    // Handed over: the buttons stay disabled (`finishing` is not cleared)
    // while the window closes, goes back to the app or shows the complete card.
    closeOrRedirect(query.pollUrl, { ...accessState, ...refused }, query.cli, closeFallback);
  }

  if (initError) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        <Alert>{initError}</Alert>
      </Card>
    );
  }

  if (requestDone) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        {/* Why the request ended refused, when the page ended it (a required consent invite failed). */}
        {error && <Alert>{error}</Alert>}
        <p className="text-sm">{t("consent.requestComplete")}</p>
      </Card>
    );
  }

  if (!accessState) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        <p className="text-sm text-muted">{t("consent.loading")}</p>
      </Card>
    );
  }

  // The app needs an account the user manages and none can be used here:
  // say why; the user can only cancel (nothing is granted on their own account).
  if (managedUnavailable != null) {
    const appName = requestingApp?.name ?? (accessState.requestingAppId || t("consent.theRequestingApp"));
    const causeKey: Record<ManagedUnavailableCause, string> = {
      "delegation-off": "consent.managedUnavailableDelegationOff",
      "info-unreadable": "consent.managedUnavailableInfoUnreadable",
      "list-failed": "consent.managedUnavailableListFailed",
      none: "consent.managedUnavailableNone",
    };
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        <p className="mb-2 text-sm">{tNodes("consent.managedUnavailable", { app: <strong>{appName}</strong> })}</p>
        <Alert tone="info">{t(causeKey[managedUnavailable])}</Alert>
        <Button
          variant="ghost"
          type="button"
          onClick={() => void refuseManagedUnavailable(managedUnavailable)}
          disabled={finishing !== null}
          className="mt-3"
        >
          {t("common.cancel")}
        </Button>
      </Card>
    );
  }

  // "Who is this for?": the signed-in account, or an account it controls.
  if (targets != null && owner != null) {
    const appName = requestingApp?.name ?? (accessState.requestingAppId || t("consent.theRequestingApp"));
    // The account the app named, when not a choice; not said of the signed-in
    // account itself (left out with `managedOnly`, not "an account you can act for").
    const named = unavailableActAs(targets, accessState.actAs);
    const unavailable = named !== owner.username ? named : null;
    // Creation is offered when the app named `actAs` or asked for a managed
    // account, and never from a session acting for another account: the new
    // account's delegate is the user.
    const offersCreation = offersCreationFor(accessState.actAs, managedOnly, actingAs != null);
    return (
      <Card>
        <h1 className="mb-2 text-2xl">
          {tNodes("consent.grantHeading", { app: <strong>{appName}</strong> })}
        </h1>
        {managedOnly && (
          <p className="mb-3 text-sm" data-testid="grant-managed-only">
            {tNodes("consent.grantManagedOnly", { app: <strong>{appName}</strong> })}
          </p>
        )}
        {listFailed ? (
          <Alert tone="info">{t(managedOnly ? "consent.grantListFailedManaged" : "consent.grantListFailed")}</Alert>
        ) : unavailable != null && (
          <Alert tone="info">
            {tNodes("consent.grantUnavailable", { username: <strong>{unavailable}</strong> })}
          </Alert>
        )}
        {targets.length === 0 && !listFailed && (
          <p className="mb-3 text-sm text-muted">{t("consent.grantManagedNone")}</p>
        )}
        {targets.length > 0 && <fieldset className="mb-4 space-y-2">
          <legend className="sr-only">{t("consent.grantLegend")}</legend>
          {targets.map((choice) => (
            <label key={choice.username} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="grant-target"
                value={choice.username}
                checked={selectedTarget === choice.username}
                onChange={() => setSelectedTarget(choice.username)}
              />
              <strong>{choice.username}</strong>
              <span className="text-muted">{choice.self ? t("consent.grantTargetSelf") : t("consent.grantTargetVia", { username: owner.username })}</span>
            </label>
          ))}
        </fieldset>}
        {createdNotice && <Alert tone="success">{createdNotice}</Alert>}
        {offersCreation && (
          <div className="mb-4">
            <button
              type="button"
              aria-expanded={createOpen}
              aria-controls="grant-create-managed"
              onClick={() => setCreateOpen(!createOpen)}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {createOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              {t("consent.createManagedToggle")}
            </button>
            {createOpen && (
              <div id="grant-create-managed" className="mt-3">
                <CreateManagedAccount
                  connection={owner.connection}
                  client={owner.client}
                  reload={async () => {}}
                  onNotice={setCreatedNotice}
                  onCreated={(_msg, created) => onManagedCreated(created)}
                  initialUsername={creationPrefill(targets, accessState.actAs, owner.username) ?? undefined}
                  embedded
                />
              </div>
            )}
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {selectedTarget == null && targets.length > 0 && (
          <p id="grant-choose-hint" className="mb-3 text-sm text-muted">{t("consent.grantChooseManaged")}</p>
        )}
        <Button
          type="button"
          onClick={() => void continueWithTarget()}
          disabled={busy || selectedTarget == null}
          aria-describedby={selectedTarget == null && targets.length > 0 ? "grant-choose-hint" : undefined}
        >
          {busy
            ? t("consent.checking")
            : selectedTarget != null
              ? t("consent.continueFor", { username: selectedTarget })
              : t("consent.continue")}
        </Button>
        <Button variant="ghost" type="button" onClick={() => void refuse()} disabled={busy || finishing !== null} className="mt-3">
          {t("common.cancel")}
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
    // An access the app already holds is shown as it is, all rows locked.
    const panelEntries = reuse != null
      ? consentEntries(
          withRequestedNames(reuse.access.permissions as OfferPermission[], accessState.requestedPermissions),
          { labelFor },
        )
      : entries;
    const panelChoice = allowsChoice && reuse == null;
    const invitesPending = invites != null && !allDecided(decisions, invites.length);
    const decide = (i: number, d: InviteDecision | null) =>
      setInviteDecisions((prev) => prev.map((v, j) => (j === i ? d : v)));
    return (
      <Card>
        <ConsentPanel
          app={{
            name: requestingApp?.name ?? accessState.requestingAppId ?? "",
            icon: requestingApp?.icon,
            description: requestingApp?.description,
          }}
          consentText={
            consentMsg != null && (
              // The app's own explanation comes before the technical breakdown.
              // Untrusted text: MarkdownLite builds React elements, never innerHTML.
              // Framed and captioned so the app's words never read as the platform's.
              <div className="mb-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("consent.appMessageCaption")}</div>
                <div
                  data-testid="consent-message"
                  className="max-h-48 overflow-y-auto rounded border border-divider p-3 text-sm"
                >
                  <MarkdownLite text={consentMsg} />
                </div>
              </div>
            )
          }
          entries={panelEntries}
          flags={panelChoice ? grantedFlags : undefined}
          onToggle={
            panelChoice
              ? (i, checked) => setGrantedFlags(grantedFlags.map((f, j) => (j === i ? checked : f)))
              : undefined
          }
          choiceHint={
            panelChoice && (
              <p className="mb-2 text-sm text-muted">
                {t("consent.choiceHint")}
              </p>
            )
          }
          expireAfterSeconds={reuse != null ? null : accessState.expireAfter ?? null}
          mismatchWarning={
            reuse != null ? t("consent.alreadyGranted") : check.mismatchingAccess ? (
              updatesInPlace(check.mismatchingAccess, accessState, grantFor != null || actingAs != null)
                ? t("consent.mismatchWillUpdate")
                : t("consent.mismatchWillReplace")
            ) : undefined
          }
          busy={finishing}
          acceptDisabled={invitesPending}
          labels={invites != null ? { accept: t("consent.continue") } : undefined}
          onAccept={() => void accept()}
          onRefuse={() => void refuse()}
        >
          {invites != null && (
            <div className="mb-4">
              {invites.map((invite, i) => {
                const view = inviteViews[i];
                const decision = inviteDecisions[i];
                const accountLabel = inviteAccountLabel(i);
                return (
                  <section
                    key={i}
                    data-testid="cmc-invite"
                    aria-labelledby={`cmc-invite-${i}-heading`}
                    className="mt-4 border-t border-divider pt-4"
                  >
                    <CmcOfferBlock
                      heading={
                        <h2 id={`cmc-invite-${i}-heading`} className="mb-2 text-base font-semibold">
                          {t("cmc.inviteHeading", { n: i + 1, count: invites.length })}{" "}
                          <span className="text-sm font-normal text-muted">
                            {invite.mandatory ? t("cmc.inviteMandatory") : t("cmc.inviteOptional")}
                          </span>
                          {accountLabel != null && (
                            <span data-testid="cmc-invite-for" className="mt-1 block text-sm">
                              {accountLabel}
                            </span>
                          )}
                        </h2>
                      }
                      offer={view?.offer ?? null}
                      loading={view?.loading ?? true}
                      error={view?.error != null ? { message: view.error, tone: "danger" } : null}
                      labelFor={labelFor}
                      busy={null}
                      disabled={finishing !== null || view == null || view.loading}
                      approveDisabled={view?.offer == null || view.scope == null}
                      onApprove={() => decide(i, "approve")}
                      onDecline={() => decide(i, "decline")}
                      decided={decision === "approve" || decision === "decline" ? decision : null}
                      onChange={() => decide(i, null)}
                      given={
                        view?.given != null
                          ? view.given.created != null
                            ? t("cmc.inviteAlreadyGivenOn", { date: formatSince(view.given.created) })
                            : t("cmc.inviteAlreadyGiven")
                          : null
                      }
                    />
                  </section>
                );
              })}
              {invitesPending && (
                <p className="mt-4 text-sm text-muted" data-testid="cmc-invites-pending">
                  {t("consent.invitesPending")}
                </p>
              )}
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </ConsentPanel>
      </Card>
    );
  }

  // Continuing with the account just created in this window: no card. And
  // while a signed-in continue runs ("Continue as", "Continue for"), the
  // request is being checked: not the sign-in form, which the page would
  // otherwise fall back to until check-app answers.
  const continuing = busy && personalToken != null;
  if (autoContinue !== "off" || continuing) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        <p className="text-sm text-muted">{t(continuing ? "consent.checking" : "consent.loading")}</p>
      </Card>
    );
  }

  // With a hint, wait until the stored session's username is known before
  // choosing between its card and the sign-in form (no flash of the wrong one).
  if (storedUsable && !personalToken && usernameHint != null && !knownResolved) {
    return (
      <Card>
        <h1 className="mb-2 text-2xl">{t("consent.title")}</h1>
        <p className="text-sm text-muted">{t("consent.loading")}</p>
      </Card>
    );
  }

  // Already signed in on this platform (persisted session): offer to
  // continue to the consent step directly, with an explicit way out so a
  // shared browser doesn't grant access under the wrong account.
  if (storedUsable && !personalToken && !hintDiffers) {
    return (
      <Card>
        <h1 className="mb-1 text-2xl">{t("consent.welcomeBack")}</h1>
        <p className="mb-6 text-sm text-muted">
          {tNodes(knownUsername ? "consent.signedInAsReview" : "consent.signedInReview", {
            username: <strong>{knownUsername}</strong>,
            app: <strong>{requestingApp?.name ?? (accessState.requestingAppId || t("consent.theRequestingApp"))}</strong>,
          })}
        </p>
        {error && <Alert>{error}</Alert>}
        <Button type="button" onClick={() => void continueAsStored()} disabled={busy}>
          {busy
            ? t("consent.checking")
            : knownUsername
              ? t("consent.continueAs", { username: knownUsername })
              : t("consent.continue")}
        </Button>
        <button
          type="button"
          onClick={() => setConnection(null)}
          disabled={busy}
          className="mt-3 w-full rounded border border-divider px-4 py-2 text-sm hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {t("consent.notMe")}
        </button>
        <Button variant="ghost" type="button" onClick={() => void refuse()} disabled={busy || finishing !== null} className="mt-3">
          {t("common.cancel")}
        </Button>
      </Card>
    );
  }

  // Shared sign-in gate (initial state).
  // Register / password-reset links need the platform's service-info URL;
  // same resolution order as makeService. They open in this window: the links
  // carry the pending access request (and the app's way back, `backUrl` /
  // `backLabel`), so a user who creates an account or resets a password comes
  // back to this consent screen instead of landing on the profile while the
  // app keeps waiting, and a pop-up keeps its opener, so completion still
  // closes it. (A new tab left the pop-up orphaned on its sign-in form.)
  const linksSvcInfoUrl = svcInfoUrlForFlow;
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
      usernameHint={usernameHint ?? ""}
      // A refusal raised on the already-authorized short-circuit lands here,
      // after check-app has answered but before any consent panel exists.
      // Without this the message would be set and never rendered.
      externalError={error}
      prompt={
        <>
          {tNodes("consent.signinPromptApp", {
            app: <strong>{requestingApp?.name ?? (accessState.requestingAppId || t("consent.theRequestingApp"))}</strong>,
          })}
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
      cancelDisabled={finishing !== null || busy}
      disabled={busy}
      footer={(formBusy) => (
        <>
          {hintDiffers && storedUsable && knownUsername && (
            <Button variant="ghost" type="button" onClick={() => void continueAsStored()} disabled={busy || formBusy} className="mt-3">
              {busy ? t("consent.checking") : t("consent.continueAsInstead", { username: knownUsername })}
            </Button>
          )}
          <div className="mt-4 flex justify-between text-sm">
            <Link
              to={`/reset-password${linksSearch}`}
              className="text-primary hover:underline"
            >
              {t("consent.forgotPassword")}
            </Link>
            <Link
              to={`/register${linksSearch}`}
              className="text-primary hover:underline"
            >
              {t("consent.createAccount")}
            </Link>
          </div>
          {serviceInfo?.support && (
            <p className="mt-6 text-sm text-muted">
              {/* Markup comes from the catalog; the link target is the platform's
                  service info, passed as a prop, never parsed from the text. */}
              <Trans
                i18nKey="consent.helpdesk"
                components={{
                  helpdeskLink: (
                    <a href={serviceInfo.support} target="_blank" rel="noreferrer" className="text-primary hover:underline" />
                  ),
                }}
              />
            </p>
          )}
        </>
      )}
    />
  );
}

/** An in-app path (`/cmc-accept?…`) as a URL path under the app's base (`build:pages` serves it under a sub-path). */
function inAppHref(path: string | null): string | null {
  if (path == null) return null;
  return import.meta.env.BASE_URL.replace(/\/$/, "") + path;
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
