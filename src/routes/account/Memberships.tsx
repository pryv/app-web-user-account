import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, X, FolderOpen } from "lucide-react";
import { cmc, type MemberRecord, type SweepRecord } from "../../lib/pryvClient";
import { Card, Button, Field, Alert, SectionLabel } from "../../components/ui";
import { ConsentActions } from "../../components/consent/ConsentActions";
import { useConfirm } from "../../components/ConfirmDialog";
import { useSession } from "../../lib/useSession";
import type { PryvConnection } from "../../lib/session";
import { pickText } from "../../lib/consent";
import { platformError, loggableError } from "../../lib/apiError";
import { maskUrlCredentials } from "../../lib/maskCredentials";
import { formatDate, formatDateTime } from "../../lib/dates";
import {
  accountLabel,
  acceptScopeFor,
  capabilityUrlFromInput,
  membershipFailure,
  requestedTeams,
  streamNamesOf,
  sweepCheckable,
  sweepCounts,
  sweepReasonKey,
  sweepState,
  sweepStateKey,
  teamName,
  type StreamNames,
} from "../../lib/memberships";

/** Most recent offboarding sweeps shown. */
const SWEEPS_SHOWN = 10;

/** The offer behind a membership request link, as `cmc.readOffer` returns it. */
interface MembershipOffer {
  requester: { username: string | null; host: string; displayName?: string };
  requestedPermissions: Array<{ streamId?: string; level?: string }>;
  consent?: Record<string, string>;
  membership?: boolean;
}

/** A request opened on the page. */
interface OpenRequest {
  capabilityUrl: string;
  offer: MembershipOffer;
  teams: string[];
  /** Where the answer is recorded on this account; null when the request names no team. */
  scope: string | null;
}

/** Query parameters of a link to this page that carries a request. */
const REQUEST_PARAMS = ["capabilityUrl", "capability"];

/**
 * Group memberships (administrator side).
 *
 * This account acts as a group (a practice, a research team). A member is
 * another account that asked to join it: the member hands over a membership
 * request link (a QR code or a link); an administrator opens it here, sees
 * who asks and for which teams, and approves it (narrowing the teams if
 * needed) or declines it. Works with the account's own session or a
 * delegate's: both may administer memberships.
 *
 * Below: the members (their account, teams, who approved them, and Revoke),
 * then the recent offboarding sweeps: ending a membership removes the
 * accesses the member was given on other accounts through the group, and
 * what could not be removed (a residual) is listed with the date it expires.
 * No token is shown anywhere on this page.
 */
export default function Memberships() {
  const { t } = useTranslation();
  const { connection, actingAs } = useSession();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const [confirm, confirmDialog] = useConfirm();

  const [names, setNames] = useState<StreamNames>(new Map());
  const [members, setMembers] = useState<MemberRecord[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [sweeps, setSweeps] = useState<SweepRecord[] | null>(null);
  const [sweepsError, setSweepsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    setMembersError(null);
    setSweepsError(null);
    const [m, s] = await Promise.allSettled([
      cmc.listMembers(connection),
      cmc.listSweeps(connection, { limit: 50 }),
    ]);
    if (m.status === "fulfilled") setMembers(m.value);
    else setMembersError(shownError(m.reason, t("memberships.errLoadMembers")));
    if (s.status === "fulfilled") setSweeps(s.value.items.slice(0, SWEEPS_SHOWN));
    else setSweepsError(shownError(s.reason, t("memberships.errLoadSweeps")));
  }, [connection, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Team names, best-effort: without them a team shows the last part of its id.
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => connection.api([{ method: "streams.get", params: { parentId: ":_cmc:apps" } }]))
      .then((results) => {
        const [res] = results as Array<{ streams?: unknown }>;
        if (!cancelled) setNames(streamNamesOf(res?.streams));
      })
      .catch(() => {
        /* display only */
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // The account that answers: the membership is created on it, whichever
  // account that is (a delegate's own session is not the group's).
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  useEffect(() => {
    if (!connection) return;
    if (actingAs?.username) {
      setSignedInAs(actingAs.username);
      return;
    }
    let cancelled = false;
    connection
      .username()
      .then((name) => {
        if (!cancelled) setSignedInAs(name);
      })
      .catch(() => {
        /* the line is left out */
      });
    return () => {
      cancelled = true;
    };
  }, [connection, actingAs?.username]);

  // A link carrying a request is consumed once: the request goes to the
  // page's state and leaves the address at once, so the token-bearing URL
  // does not ride on the other tabs' links or stay in the history, and coming
  // back to the tab does not read it again.
  const linkedUrl = new URLSearchParams(search).get("capabilityUrl") ?? new URLSearchParams(search).get("capability");
  const [linked, setLinked] = useState<{ url: string; n: number } | null>(null);
  useEffect(() => {
    if (!linkedUrl) return;
    setLinked((prev) => ({ url: linkedUrl, n: (prev?.n ?? 0) + 1 }));
    const rest = new URLSearchParams(search);
    for (const p of REQUEST_PARAMS) rest.delete(p);
    const q = rest.toString();
    navigate(pathname + (q ? "?" + q : ""), { replace: true });
  }, [linkedUrl, search, pathname, navigate]);

  async function revoke(m: MemberRecord) {
    if (!connection) return;
    const who = accountLabel(m.member, t("memberships.unknownMember"));
    setNotice(null);
    setRevokeError(null);
    if (m.scopeStreamId == null) {
      setRevokeError(t("memberships.errRevokeNoScope", { member: who }));
      return;
    }
    const ok = await confirm(t("memberships.confirmRevoke", { member: who }), {
      confirmLabel: t("memberships.revoke"),
      danger: true,
    });
    if (!ok) return;
    setRevoking(m.membershipAccessId);
    try {
      await cmc.revokeMembership(connection, {
        membershipAccessId: m.membershipAccessId,
        scopeStreamId: m.scopeStreamId,
      });
      setNotice(t("memberships.noticeRevoked", { member: who }));
      await load();
    } catch (err: unknown) {
      console.warn("memberships: could not revoke:", loggableError(err));
      setRevokeError(shownError(err, t("memberships.errRevoke")));
    } finally {
      setRevoking(null);
    }
  }

  async function checkSweep(sweepEventId: string) {
    if (!connection) return;
    setChecking(sweepEventId);
    setSweepsError(null);
    try {
      const fresh = await cmc.getSweepStatus(connection, sweepEventId);
      setSweeps((list) => list?.map((s) => (s.sweepEventId === sweepEventId ? fresh : s)) ?? null);
    } catch (err: unknown) {
      setSweepsError(shownError(err, t("memberships.errLoadSweeps")));
    } finally {
      setChecking(null);
    }
  }

  if (!connection) {
    return <p className="text-sm text-muted">{t("common.loading")}</p>;
  }

  return (
    <section className="space-y-8">
      {confirmDialog}
      <p className="text-sm text-muted">{t("memberships.intro")}</p>
      {notice && <Alert tone="success">{notice}</Alert>}

      <MembershipRequest
        connection={connection}
        names={names}
        linked={linked}
        signedInAs={signedInAs}
        onAnswered={(text) => {
          setNotice(text);
          void load();
        }}
      />

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="text-lg">{t("memberships.membersTitle")}</h2>
          <RefreshButton onClick={load} />
        </div>
        {membersError && <Alert>{membersError}</Alert>}
        {revokeError && <Alert>{revokeError}</Alert>}
        {members === null && !membersError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {members?.length === 0 && <p className="text-sm text-muted">{t("memberships.noMembers")}</p>}
        <div className="space-y-3">
          {members?.map((m) => (
            <Card key={m.membershipAccessId}>
              <div className="flex items-start justify-between gap-4" data-testid="membership-member">
                <div className="min-w-0">
                  <div className="font-medium break-all">{accountLabel(m.member, t("memberships.unknownMember"))}</div>
                  <div className="text-xs text-muted">
                    {t("memberships.teams", {
                      teams: m.scopes.map((s) => teamName(s.streamId, names)).join(", ") || t("memberships.noTeams"),
                    })}
                  </div>
                  <div className="text-xs text-muted">
                    {m.approvedBy != null
                      ? t("memberships.approvedByDelegate", { username: m.approvedBy.delegate.username })
                      : t("memberships.approvedByOwner")}
                    {m.created != null && t("memberships.sinceSuffix", { date: formatDate(m.created) })}
                  </div>
                  {m.expires != null && (
                    <div className="text-xs text-muted">{t("memberships.expires", { date: formatDate(m.expires) })}</div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={revoking === m.membershipAccessId}
                  onClick={() => void revoke(m)}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden />
                  {revoking === m.membershipAccessId ? t("memberships.revoking") : t("memberships.revoke")}
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="text-lg">{t("memberships.sweepsTitle")}</h2>
          <RefreshButton onClick={load} />
        </div>
        <p className="mb-4 text-sm text-muted">{t("memberships.sweepsIntro")}</p>
        {sweepsError && <Alert>{sweepsError}</Alert>}
        {sweeps === null && !sweepsError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {sweeps?.length === 0 && <p className="text-sm text-muted">{t("memberships.noSweeps")}</p>}
        <div className="space-y-3">
          {sweeps?.map((s) => (
            <SweepCard
              key={s.sweepEventId}
              sweep={s}
              checking={checking === s.sweepEventId}
              onCheck={() => void checkSweep(s.sweepEventId)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** What the page shows for a failed call: the platform's message, never a token. */
function shownError(err: unknown, fallback: string): string {
  return maskUrlCredentials(platformError(err, fallback).message);
}

/* ------------------------------------------------------------------ */
/* A membership request, opened from its link                           */
/* ------------------------------------------------------------------ */

function MembershipRequest({
  connection,
  names,
  linked,
  signedInAs,
  onAnswered,
}: {
  connection: PryvConnection;
  names: StreamNames;
  /** A request link this page was opened with (`?capabilityUrl=`), once taken out of the address. */
  linked: { url: string; n: number } | null;
  /** The account the session acts on: the membership is created on it. */
  signedInAs: string | null;
  onAnswered: (notice: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState("");
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; tone: "danger" | "info" } | null>(null);
  const [busy, setBusy] = useState<"accept" | "refuse" | null>(null);

  const open = useCallback(
    async (raw: string) => {
      setError(null);
      setRequest(null);
      const capabilityUrl = capabilityUrlFromInput(raw);
      if (capabilityUrl == null) {
        setError({ message: i18n.t("memberships.errNotALink"), tone: "danger" });
        return;
      }
      setLoading(true);
      try {
        const offer = (await cmc.readOffer(capabilityUrl)) as MembershipOffer;
        if (offer.membership !== true) {
          setError({ message: i18n.t("memberships.errNotMembership"), tone: "danger" });
          return;
        }
        const teams = requestedTeams(offer.requestedPermissions);
        // Always derived from the request (the app its teams belong to), never
        // from the link: where the group files the membership is the group's
        // page's decision. A request mixing two apps is filed under the first;
        // the platform refuses what is not a team stream.
        const scope = acceptScopeFor(offer.requestedPermissions);
        setRequest({ capabilityUrl, offer, teams, scope });
        setSelected(teams);
      } catch (err: unknown) {
        console.warn("memberships: could not read the request:", loggableError(err));
        setError({ message: i18n.t("memberships.errUnreadable"), tone: "danger" });
      } finally {
        setLoading(false);
      }
    },
    // `i18n` is stable: a language change does not read the request again.
    [i18n],
  );

  // Opened from a link carrying the request: read it once.
  useEffect(() => {
    if (linked) void open(linked.url);
  }, [linked, open]);

  function close() {
    setRequest(null);
    setError(null);
    setInput("");
  }

  async function approve() {
    if (!request?.scope || selected.length === 0) return;
    const who = accountLabel(request.offer.requester, t("cmc.unidentifiedRequester"));
    setBusy("accept");
    setError(null);
    try {
      await cmc.acceptMembership(connection, request.capabilityUrl, {
        scopeStreamId: request.scope,
        grantedScopes: selected,
      });
      setRequest(null);
      setInput("");
      onAnswered(t("memberships.noticeApproved", { member: who }));
    } catch (err: unknown) {
      console.warn("memberships: could not approve:", loggableError(err));
      const failure = membershipFailure(err, t("memberships.errApprove"));
      setError({ message: maskUrlCredentials(failure.message), tone: failure.tone });
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    if (!request?.scope) return;
    const who = accountLabel(request.offer.requester, t("cmc.unidentifiedRequester"));
    setBusy("refuse");
    setError(null);
    try {
      await cmc.declineMembership(connection, request.capabilityUrl, { scopeStreamId: request.scope });
      setRequest(null);
      setInput("");
      onAnswered(t("memberships.noticeDeclined", { member: who }));
    } catch (err: unknown) {
      console.warn("memberships: could not decline:", loggableError(err));
      const failure = membershipFailure(err, t("memberships.errDecline"));
      setError({ message: maskUrlCredentials(failure.message), tone: failure.tone });
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void open(input);
  }

  function toggle(team: string, checked: boolean) {
    setSelected((prev) =>
      checked ? request!.teams.filter((x) => x === team || prev.includes(x)) : prev.filter((x) => x !== team),
    );
  }

  const consentText = request ? pickText(request.offer.consent, i18n.language || "en") : "";

  return (
    <div>
      <h2 className="mb-2 text-lg">{t("memberships.requestTitle")}</h2>
      <p className="mb-4 text-sm text-muted">{t("memberships.requestHint")}</p>
      {error && <Alert tone={error.tone}>{error.message}</Alert>}
      {loading && <p className="mb-4 text-sm text-muted">{t("memberships.reading")}</p>}

      {request == null ? (
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Field
                id="membership-link"
                label={t("memberships.linkLabel")}
                value={input}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setInput(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading || input.trim() === ""} className="sm:w-auto sm:self-start">
              <FolderOpen size={14} aria-hidden className="mr-1" />
              {t("memberships.open")}
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <div data-testid="membership-request">
            <div className="mb-3 flex items-start justify-between gap-4">
              <p className="text-sm text-muted">
                <strong className="text-ink break-all" data-testid="membership-requester">
                  {accountLabel(request.offer.requester, t("cmc.unidentifiedRequester"))}
                </strong>
                {request.offer.requester.displayName && (
                  <span> {t("cmc.callsItself", { name: request.offer.requester.displayName })}</span>
                )}{" "}
                {t("memberships.asksToJoin")}
              </p>
              <button
                type="button"
                onClick={close}
                disabled={busy !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-sm text-muted hover:bg-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <X size={14} aria-hidden /> {t("memberships.close")}
              </button>
            </div>
            {consentText !== "" && <p className="mb-3 text-base text-ink">{consentText}</p>}
            <SectionLabel>{t("memberships.teamsLegend")}</SectionLabel>
            {request.teams.length === 0 ? (
              <Alert>{t("memberships.errNoTeams")}</Alert>
            ) : (
              <ul className="mb-3 space-y-1 text-sm">
                {request.teams.map((team, i) => (
                  <li key={team} className="rounded bg-body px-3 py-2 break-all">
                    <label className="flex items-center gap-2">
                      <input
                        id={`membership-team-${i}`}
                        type="checkbox"
                        checked={selected.includes(team)}
                        disabled={busy !== null}
                        onChange={(e) => toggle(team, e.target.checked)}
                      />
                      <span>{teamName(team, names)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-4 text-sm text-muted">{t("memberships.requestExplain")}</p>
            {request.teams.length > 0 && selected.length === 0 && (
              <p className="mb-3 text-sm text-danger">{t("memberships.tickOneTeam")}</p>
            )}
            {signedInAs != null && (
              <div className="mb-3 text-sm" data-testid="membership-approving-as">
                <p>{t("cmc.approvingAs", { username: signedInAs })}</p>
                <p className="text-xs text-muted">{t("memberships.approvingAsHint")}</p>
              </div>
            )}
            <ConsentActions
              busy={busy}
              disabled={request.scope == null}
              acceptDisabled={selected.length === 0}
              acceptLabel={t("cmc.approve")}
              refuseLabel={t("cmc.decline")}
              onAccept={() => void approve()}
              onRefuse={() => void decline()}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One offboarding sweep                                                */
/* ------------------------------------------------------------------ */

function SweepCard({ sweep: s, checking, onCheck }: { sweep: SweepRecord; checking: boolean; onCheck: () => void }) {
  const { t } = useTranslation();
  const counts = sweepCounts(s.outcome);
  const state = sweepState(s);
  const reason = t(sweepReasonKey(s.reason));
  return (
    <Card>
      <div data-testid="membership-sweep">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium break-all">{accountLabel(s.member, t("memberships.unknownMember"))}</div>
            <div className="text-xs text-muted">
              {s.time != null ? t("memberships.sweepWhen", { reason, date: formatDateTime(s.time) }) : reason}
            </div>
          </div>
          <span
            data-testid="membership-sweep-status"
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
              state === "failed"
                ? "bg-danger/10 text-danger"
                : state === "done"
                  ? "bg-success/10 text-success"
                  : "bg-info/10 text-info"
            }`}
          >
            {t(sweepStateKey(state))}
          </span>
        </div>
        <p className="mt-2 text-sm">
          {t("memberships.sweepCounts", { deleted: counts.deleted, absent: counts.absent, residual: counts.residual })}
        </p>
        {state === "residual" && (
          <p className="mt-1 text-sm" data-testid="membership-sweep-residual">
            {t("memberships.sweepResidual")}
          </p>
        )}
        {/* Another reason: said, with its id for a support request; its detail is never shown. */}
        {state === "failed" && (
          <p className="mt-1 text-sm text-danger" data-testid="membership-sweep-stopped">
            {t("memberships.sweepStopped")} <code className="break-all">{s.failure?.reason ?? ""}</code>
          </p>
        )}
        {s.residuals.length > 0 && (
          <div className="mt-2">
            <SectionLabel tone="danger">{t("memberships.residualsTitle")}</SectionLabel>
            <ul className="space-y-1 text-sm" data-testid="membership-residuals">
              {s.residuals.map((r) => (
                <li key={r.childAccessId} className="rounded bg-body px-3 py-2 break-all">
                  {t("memberships.residual", {
                    account: accountLabel(r.counterparty, t("memberships.unknownMember")),
                    date: formatDateTime(r.expires),
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sweepCheckable(s) && (
          <div className="mt-2">
            <button
              type="button"
              disabled={checking}
              onClick={onCheck}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <RefreshCw size={14} aria-hidden /> {checking ? t("memberships.checking") : t("memberships.checkAgain")}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function RefreshButton({ onClick }: { onClick: () => Promise<void> | void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <RefreshCw size={14} aria-hidden /> {t("common.refresh")}
    </button>
  );
}
