import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../../components/ui";
import { AsGate, AsNotice } from "../../components/AsGate";
import { useSession } from "../../lib/useSession";
import { useAsResolution } from "../../lib/useAuditAs";
import type { PryvConnection } from "../../lib/session";
import {
  AUDIT_ACTIONS_PARENT_STREAM_ID,
  AUDIT_ACTION_STREAM_PREFIX,
  accessesWithDeletions,
  auditAccessId,
  auditAction,
  buildTrailGetParams,
  findAccess,
  isAuditError,
  type AccessDetails,
  type AuditEvent,
  type TrailKind,
} from "../../lib/audit";
import {
  parseTrailSearch,
  resolveAppAccessIds,
  searchWith,
  timeToInput,
  withoutTrailFilters,
} from "../../lib/trail";
import { entryNaming } from "../../lib/oauthClient";
import { useAccessNaming } from "../../extensions/accessNaming";
import { formatDateTime } from "../../lib/dates";
import { maskCredentials, maskUrlCredentials } from "../../lib/maskCredentials";
import { platformError } from "../../lib/apiError";

const PAGE_SIZE = 15;
const INPUT =
  "rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary";

const KIND_OPTIONS: Array<{ value: "" | TrailKind; label: string }> = [
  { value: "", label: "trail.kindAll" },
  { value: "read", label: "trail.kindRead" },
  { value: "write", label: "trail.kindWrite" },
  { value: "session", label: "trail.kindSession" },
  { value: "error", label: "trail.kindError" },
];

/**
 * The Audit trail tab (`/account/audit`): every audited call on the account,
 * newest first, filtered by the URL (see `lib/trail.ts` for the contract). The
 * URL is the single source of truth: Apply writes the filters back (replace),
 * every other parameter kept; the page number is not in the URL and goes back
 * to the first page on Apply. `as` is read once and dropped, as on the access
 * page.
 */
export default function AuditTrail() {
  const { t } = useTranslation();
  const { connection } = useSession();
  const { search } = useLocation();
  const [, setSearchParams] = useSearchParams();
  const asRes = useAsResolution(search);
  const ready = asRes.ready;
  const filters = useMemo(() => parseTrailSearch(search), [search]);

  // Every access of the account, removed ones included: names the Access
  // column and resolves `app`.
  const [accessList, setAccessList] = useState<AccessDetails[] | null>(null);
  const [accessesError, setAccessesError] = useState<string | null>(null);
  // Methods ever used on the account: the Action dropdown and the class lists.
  const [actions, setActions] = useState<string[] | null>(null);
  const [actionsFailed, setActionsFailed] = useState(false);

  useEffect(() => {
    if (!connection || !ready) return;
    let cancelled = false;
    setAccessList(null);
    setAccessesError(null);
    setActions(null);
    setActionsFailed(false);
    void (async () => {
      try {
        const [accRes, streamsRes] = (await connection.api([
          { method: "accesses.get", params: { includeExpired: true, includeDeletions: true } },
          { method: "streams.get", params: { parentId: AUDIT_ACTIONS_PARENT_STREAM_ID } },
        ])) as [
          { accesses?: AccessDetails[]; accessDeletions?: AccessDetails[]; error?: { message: string } } | undefined,
          { streams?: Array<{ id: string }>; error?: { message: string } } | undefined,
        ];
        if (cancelled) return;
        if (accRes?.error) setAccessesError(shownError(new Error(accRes.error.message), t("trail.errorAccesses")));
        else setAccessList(accessesWithDeletions(accRes ?? {}));
        if (streamsRes?.error) {
          setActionsFailed(true);
          setActions([]);
        } else {
          setActions(
            (streamsRes?.streams ?? [])
              .map((s) => s.id)
              .filter((id) => id.startsWith(AUDIT_ACTION_STREAM_PREFIX))
              .map((id) => id.slice(AUDIT_ACTION_STREAM_PREFIX.length))
              .sort(),
          );
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setAccessesError(shownError(err, t("trail.errorAccesses")));
        setActionsFailed(true);
        setActions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, ready, t]);

  // The accesses the view is filtered to: `app` wins over `access`; null = all.
  const appIds = filters.app != null && accessList != null ? resolveAppAccessIds(accessList, filters.app) : null;
  const accessIds: string[] | null | undefined =
    filters.app != null ? (accessList != null ? appIds : undefined) : filters.access != null ? [filters.access] : null;
  const needsClasses = filters.action == null && (filters.kind === "read" || filters.kind === "write" || filters.kind === "session");
  const classUnavailable = needsClasses && actionsFailed;
  const appUnresolvable = filters.app != null && accessesError != null;
  const waiting = accessIds === undefined || (needsClasses && actions == null);

  // The page belongs to the filters it was turned on: new filters, first page.
  const [pageState, setPageState] = useState({ key: search, page: 0 });
  const page = pageState.key === search ? pageState.page : 0;
  const setPage = (p: number) => setPageState({ key: search, page: p });
  const [refreshTick, setRefreshTick] = useState(0);

  const params = useMemo(
    () =>
      waiting || classUnavailable || appUnresolvable || accessIds === undefined
        ? undefined
        : buildTrailGetParams({
            accessIds,
            kind: filters.kind,
            action: filters.action,
            // Only a class `kind` reads the action list: other views do not
            // wait for it, nor ask again once it arrives.
            actions: needsClasses ? (actions ?? []) : [],
            fromTime: filters.from,
            toTime: filters.to,
            page,
            pageSize: PAGE_SIZE,
          }),
    // `accessIds` is derived from the list and the filters: key it by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waiting, classUnavailable, appUnresolvable, JSON.stringify(accessIds), filters, needsClasses ? actions : null, page],
  );

  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connection || !ready) return;
    if (params === undefined) {
      // Waiting for the access list or the action list, or nothing to ask.
      setRows(null);
      setHasNext(false);
      return;
    }
    if (params === null) {
      // Nothing can match: no request.
      setRows([]);
      setHasNext(false);
      setTrailError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setTrailError(null);
    void (async () => {
      try {
        const [res] = (await connection.api([{ method: "events.get", params }])) as Array<{
          events?: AuditEvent[];
          error?: { message: string };
        }>;
        if (cancelled) return;
        if (res?.error) throw new Error(res.error.message);
        const events = res?.events ?? [];
        setHasNext(events.length > PAGE_SIZE);
        setRows(events.slice(0, PAGE_SIZE));
      } catch (err: unknown) {
        if (cancelled) return;
        setTrailError(shownError(err, t("audit.errorLoadTrail")));
        setRows([]);
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, ready, params, refreshTick, t]);

  const intro = <p className="text-sm text-muted">{t("trail.intro")}</p>;
  if (!ready) return <AsGate as={asRes}>{intro}</AsGate>;

  const linkSearch = withoutTrailFilters(search);
  const oneAccess = accessIds != null && accessIds !== undefined && accessIds.length === 1;
  // The one access the view is on, when the filters name one: `access`, or an
  // `app` that resolves to a single access. Its id is shown only when it is a
  // known access (a link must not put its own words on the page).
  const focusId = filters.app != null ? (appIds?.length === 1 ? appIds[0] : undefined) : filters.access;
  const focused = focusId != null ? findAccess(accessList ?? [], focusId) : undefined;
  const clearFocus = filters.app != null ? { app: null, access: null } : { access: null };

  function apply(next: FormValues) {
    setSearchParams(
      (current) => {
        const out = new URLSearchParams(current);
        const put = (key: string, value: string | undefined) => {
          if (value == null || value === "") out.delete(key);
          else out.set(key, value);
        };
        put("from", next.from);
        put("to", next.to);
        put("kind", next.kind);
        put("action", next.action);
        put("app", next.app);
        setPageState({ key: "?" + out.toString(), page: 0 });
        return out;
      },
      { replace: true },
    );
    setRefreshTick((n) => n + 1);
  }

  return (
    <section className="space-y-4">
      {intro}
      <AsNotice state={asRes.state} />
      <Card>
        <h2 className="mb-3 text-xs font-normal uppercase tracking-wide text-muted">{t("trail.title")}</h2>
        <TrailForm key={search} search={search} actions={actions ?? []} busy={busy} onApply={apply} onRefresh={() => setRefreshTick((n) => n + 1)} />

        {focusId != null && (
          <p className="mb-3 text-sm" data-testid="trail-access-filter">
            {focused
              ? t("trail.accessFilter", { name: maskUrlCredentials(entryNaming({ access: focused, sessions: [] }).label) })
              : t("trail.accessFilterUnknown")}
            {focused?.deleted != null && (
              <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">{t("trail.removed")}</span>
            )}{" "}
            <Link
              to={{ pathname: "/account/audit", search: searchWith(search, clearFocus) }}
              className="text-primary underline"
            >
              {t("trail.clearAccess")}
            </Link>
          </p>
        )}
        {filters.app != null && appIds != null && appIds.length === 0 && (
          <Alert tone="info">{t("trail.appNoMatch", { app: capped(filters.app) })}</Alert>
        )}
        {accessesError && <Alert>{accessesError}</Alert>}
        {classUnavailable && <Alert>{t("trail.errorActions")}</Alert>}
        {trailError && <Alert>{trailError}</Alert>}

        {rows === null && !trailError && !classUnavailable && !appUnresolvable && (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        )}
        {rows?.length === 0 && !trailError && <p className="text-sm text-muted">{t("trail.noEntries")}</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-divider text-xs text-muted">
                  <th className="py-1 pr-4 font-normal">{t("audit.colTime")}</th>
                  {!oneAccess && <th className="py-1 pr-4 font-normal">{t("trail.colAccess")}</th>}
                  <th className="py-1 pr-4 font-normal">{t("audit.colAction")}</th>
                  <th className="py-1 pr-4 font-normal">{t("audit.colStatus")}</th>
                  <th className="py-1 pr-4 font-normal">{t("audit.colSource")}</th>
                  <th className="py-1 font-normal">{t("audit.colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-divider/50 align-top">
                    <td className="whitespace-nowrap py-1 pr-4 text-xs">{formatDateTime(e.time) || "—"}</td>
                    {!oneAccess && (
                      <td className="py-1 pr-4 text-xs">
                        <AccessCell
                          id={auditAccessId(e)}
                          accesses={accessList ?? []}
                          connection={connection}
                          search={linkSearch}
                        />
                      </td>
                    )}
                    <td className="py-1 pr-4 font-mono text-xs">{auditAction(e)}</td>
                    <td className="py-1 pr-4">
                      {isAuditError(e) ? (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">{t("audit.statusError")}</span>
                      ) : (
                        <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">{t("audit.statusOk")}</span>
                      )}
                    </td>
                    <td className="py-1 pr-4 text-xs">
                      {e.content?.source?.ip ?? "—"}
                      {e.content?.callerId && (
                        <span className="block break-all text-muted" title={t("audit.callerIdHint")}>
                          {t("audit.callerId", { callerId: maskUrlCredentials(e.content.callerId) })}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[16rem] truncate py-1 font-mono text-xs" title={detailText(e)}>
                      {detailText(e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-sm">
          <Button
            variant="ghost"
            type="button"
            disabled={busy || page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
            className="w-auto"
          >
            <ChevronLeft size={14} aria-hidden className="mr-1" /> {t("common.previous")}
          </Button>
          <span className="text-xs text-muted">{t("common.page", { page: page + 1 })}</span>
          <Button
            variant="ghost"
            type="button"
            disabled={busy || !hasNext}
            onClick={() => setPage(page + 1)}
            className="w-auto"
          >
            {t("common.next")} <ChevronRight size={14} aria-hidden className="ml-1" />
          </Button>
        </div>
      </Card>
    </section>
  );
}

interface FormValues {
  from?: string;
  to?: string;
  kind?: string;
  action?: string;
  app?: string;
}

/**
 * The filter form, staged until Apply. Mounted afresh for each URL (keyed by
 * it), so its fields always start from what the URL says. A time field left
 * as the URL gave it keeps the URL's own spelling (Unix seconds, a date alone).
 */
function TrailForm({
  search,
  actions,
  busy,
  onApply,
  onRefresh,
}: {
  search: string;
  actions: string[];
  busy: boolean;
  onApply: (values: FormValues) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const raw = new URLSearchParams(search);
  const parsed = parseTrailSearch(search);
  const fromInitial = timeToInput(parsed.from);
  const toInitial = timeToInput(parsed.to);
  const [from, setFrom] = useState(fromInitial);
  const [to, setTo] = useState(toInitial);
  const [kind, setKind] = useState<string>(parsed.kind ?? "");
  const [action, setAction] = useState(parsed.action ?? "");
  const [app, setApp] = useState(parsed.app ?? "");
  const actionOptions = parsed.action && !actions.includes(parsed.action) ? [parsed.action, ...actions] : actions;

  function submit(e: FormEvent) {
    e.preventDefault();
    onApply({
      from: from === fromInitial && parsed.from !== undefined ? (raw.get("from") ?? undefined) : from,
      to: to === toInitial && parsed.to !== undefined ? (raw.get("to") ?? undefined) : to,
      kind,
      action,
      app: app.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-3 text-sm" aria-label={t("trail.title")}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("common.from")}</span>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("common.to")}</span>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("trail.kind")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={INPUT}>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("audit.action")}</span>
        <select value={action} onChange={(e) => setAction(e.target.value)} className={INPUT}>
          <option value="">{t("audit.allActions")}</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t("trail.app")}</span>
        <input
          type="text"
          value={app}
          onChange={(e) => setApp(e.target.value)}
          placeholder={t("trail.appHint")}
          title={t("trail.appHint")}
          className={INPUT}
        />
      </label>
      <Button type="submit" disabled={busy} className="w-auto">
        {t("common.apply")}
      </Button>
      <Button variant="ghost" type="button" disabled={busy} onClick={onRefresh} className="w-auto">
        <RefreshCw size={14} aria-hidden className="mr-1" /> {t("common.refresh")}
      </Button>
    </form>
  );
}

/** The access an entry is filed under: its name linking to its page (marked when removed), else its id. */
function AccessCell({
  id,
  accesses,
  connection,
  search,
}: {
  id: string | null;
  accesses: AccessDetails[];
  connection: PryvConnection | null;
  search: string;
}) {
  const access = id != null ? findAccess(accesses, id) : undefined;
  if (id == null) return <>{"—"}</>;
  if (!access) return <span className="break-all font-mono">{id}</span>;
  return <AccessName access={access} connection={connection} search={search} />;
}

function AccessName({
  access,
  connection,
  search,
}: {
  access: AccessDetails;
  connection: PryvConnection | null;
  search: string;
}) {
  const { t } = useTranslation();
  const entry = { access, sessions: [] };
  const naming = useAccessNaming(connection, entry) ?? entryNaming(entry);
  return (
    <>
      <Link to={`/account/audit-access/${encodeURIComponent(access.id)}${search}`} className="text-primary underline">
        {maskUrlCredentials(naming.label)}
      </Link>
      {access.deleted != null && <span className="ml-1 text-muted">({t("trail.removed")})</span>}
    </>
  );
}

/**
 * An error as the page shows it: the platform's own message (never a client
 * wrapper's, which could embed the call's parameters), any URL's token masked.
 */
function shownError(err: unknown, fallback: string): string {
  return maskUrlCredentials(platformError(err, fallback).message);
}

/** Longest part of a free-text URL value the page echoes. */
const MAX_ECHO = 200;

/** `text` cut at `MAX_ECHO` characters (a link cannot paste a paragraph into the page). */
function capped(text: string): string {
  return text.length > MAX_ECHO ? text.slice(0, MAX_ECHO) + "…" : text;
}

function detailText(e: AuditEvent): string {
  if (isAuditError(e)) {
    return maskUrlCredentials([e.content?.id, e.content?.message].filter(Boolean).join(": ")) || "—";
  }
  return e.content?.query && Object.keys(e.content.query).length > 0
    ? JSON.stringify(maskCredentials(e.content.query))
    : "—";
}
