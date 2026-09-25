import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../../components/ui";
import { useConfirm } from "../../components/ConfirmDialog";
import { useSession, signinPath } from "../../lib/session";
import {
  buildAuditGetParams,
  auditAction,
  isAuditError,
  dateInputToTime,
  AUDIT_ACTIONS_PARENT_STREAM_ID,
  AUDIT_ACTION_STREAM_PREFIX,
  buildDataGetParams,
  filterEventsByAccess,
  eventRelation,
  DATA_BATCH_LIMIT,
  type AuditEvent,
  type DataEvent,
} from "../../lib/audit";
import { MarkdownLite } from "../../lib/markdownLite";
import { CONSENT_KEY, consentMessage } from "../../lib/consentMessage";
import { delegationManagedKind } from "../../lib/delegation";

interface AccessDetails {
  id: string;
  name?: string;
  type?: string;
  deviceName?: string;
  permissions?: Array<{ streamId?: string; tag?: string; feature?: string; level?: string; setting?: string }>;
  created?: number;
  createdBy?: string;
  modified?: number;
  modifiedBy?: string;
  lastUsed?: number;
  expires?: number | null;
  expired?: boolean;
  clientData?: Record<string, unknown>;
}

const PAGE_SIZE = 15;

const RELATION_KEYS: Record<ReturnType<typeof eventRelation>, string> = {
  created: "audit.relationCreated",
  modified: "audit.relationModified",
  "created + modified": "audit.relationCreatedModified",
};

function fmtTime(t?: number | null): string {
  return t ? new Date(t * 1000).toLocaleString() : "—";
}

/**
 * Access detail + audit trail. The audit store keeps a per-access stream
 * (`:_audit:access-<id>`) that outlives the access itself, so the trail stays
 * readable even after the access was revoked.
 */
export default function AuditAccess() {
  const { t } = useTranslation();
  const { accessId } = useParams<{ accessId: string }>();
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();
  // Carried on every in-app link so the platform choice (pryvServiceInfoUrl) survives.
  const { search } = useLocation();
  const [confirm, confirmDialog] = useConfirm();

  const [details, setDetails] = useState<AccessDetails | null>(null);
  const [detailsMissing, setDetailsMissing] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selfAccessId, setSelfAccessId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Filters (applied values drive the query; inputs are staged until Apply).
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [errorsOnlyInput, setErrorsOnlyInput] = useState(false);
  const [actionInput, setActionInput] = useState("");
  const [applied, setApplied] = useState<{
    fromTime?: number;
    toTime?: number;
    errorsOnly: boolean;
    action?: string;
  }>({ errorsOnly: false });
  const [page, setPage] = useState(0);

  // Actions ever used on this account — populates the action filter dropdown.
  const [actions, setActions] = useState<string[]>([]);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    void (async () => {
      try {
        const [res] = (await connection.api([
          { method: "streams.get", params: { parentId: AUDIT_ACTIONS_PARENT_STREAM_ID } },
        ])) as Array<{ streams?: Array<{ id: string }>; error?: { message: string } }>;
        if (cancelled || res?.error) return; // dropdown is a nicety — stay silent
        const list = (res?.streams ?? [])
          .map((s) => s.id)
          .filter((id) => id.startsWith(AUDIT_ACTION_STREAM_PREFIX))
          .map((id) => id.slice(AUDIT_ACTION_STREAM_PREFIX.length))
          .sort();
        setActions(list);
      } catch {
        // ignore — filter dropdown simply stays empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Self-access marker: warn before the user revokes the very access their
  // session runs on (revoking it signs them out).
  useEffect(() => {
    if (!connection) return;
    connection
      .accessInfo()
      .then((info: unknown) => {
        const id = (info as { id?: string } | null)?.id;
        if (id) setSelfAccessId(id);
      })
      .catch(() => {
        /* non-fatal — UX helper only */
      });
  }, [connection]);

  async function revoke() {
    if (!connection || !accessId) return;
    const isSelf = accessId === selfAccessId;
    const ok = await confirm(
      isSelf
        ? t("audit.confirmRevokeSelf")
        : t("audit.confirmRevoke"),
      { confirmLabel: t("audit.revoke"), danger: true },
    );
    if (!ok) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      const [res] = (await connection.api([
        { method: "accesses.delete", params: { id: accessId } },
      ])) as Array<{ error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      if (isSelf) {
        // Navigate FIRST — see AccountLayout signOut for the same race fix.
        const target = signinPath(search);
        navigate(target, { replace: true });
        setConnection(null);
        return;
      }
      navigate("/account/apps" + search);
    } catch (err: unknown) {
      setRevokeError(err instanceof Error ? err.message : t("audit.errorRevoke"));
      setRevoking(false);
    }
  }

  // Access details — accesses.get includes expired ones so revoked-but-listed
  // accesses still resolve; a fully deleted access keeps its audit trail.
  useEffect(() => {
    if (!connection || !accessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [res] = (await connection.api([
          { method: "accesses.get", params: { includeExpired: true } },
        ])) as Array<{ accesses?: AccessDetails[]; error?: { message: string } }>;
        if (cancelled) return;
        if (res?.error) throw new Error(res.error.message);
        const found = (res?.accesses ?? []).find((a) => a.id === accessId);
        if (found) {
          setDetails(found);
        } else {
          setDetailsMissing(true);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setDetailsError(err instanceof Error ? err.message : t("audit.errorLoadDetails"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, accessId, t]);

  const loadAudit = useCallback(async () => {
    if (!connection || !accessId) return;
    setBusy(true);
    setAuditError(null);
    try {
      const params = buildAuditGetParams({
        accessId,
        fromTime: applied.fromTime,
        toTime: applied.toTime,
        errorsOnly: applied.errorsOnly,
        action: applied.action,
        page,
        pageSize: PAGE_SIZE,
      });
      const [res] = (await connection.api([{ method: "events.get", params }])) as Array<{
        events?: AuditEvent[];
        error?: { message: string };
      }>;
      if (res?.error) throw new Error(res.error.message);
      const events = res?.events ?? [];
      setHasNext(events.length > PAGE_SIZE);
      setRows(events.slice(0, PAGE_SIZE));
    } catch (err: unknown) {
      setAuditError(err instanceof Error ? err.message : t("audit.errorLoadTrail"));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [connection, accessId, applied, page, t]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  // Data created / modified by this access. events.get cannot filter by
  // createdBy/modifiedBy server-side, so we fetch the window (bounded batch)
  // and filter client-side; pagination is over the filtered list.
  const [dataFromInput, setDataFromInput] = useState("");
  const [dataToInput, setDataToInput] = useState("");
  const [dataApplied, setDataApplied] = useState<{ fromTime?: number; toTime?: number }>({});
  const [dataRows, setDataRows] = useState<DataEvent[] | null>(null);
  const [dataTruncated, setDataTruncated] = useState(false);
  const [dataPage, setDataPage] = useState(0);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!connection || !accessId) return;
    setDataBusy(true);
    setDataError(null);
    try {
      const [res] = (await connection.api([
        { method: "events.get", params: buildDataGetParams(dataApplied) },
      ])) as Array<{ events?: DataEvent[]; error?: { message: string } }>;
      if (res?.error) throw new Error(res.error.message);
      const events = res?.events ?? [];
      setDataTruncated(events.length >= DATA_BATCH_LIMIT);
      setDataRows(filterEventsByAccess(events, accessId));
    } catch (err: unknown) {
      setDataError(err instanceof Error ? err.message : t("audit.errorLoadData"));
      setDataRows([]);
    } finally {
      setDataBusy(false);
    }
  }, [connection, accessId, dataApplied, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function applyDataFilters(e: FormEvent) {
    e.preventDefault();
    setDataPage(0);
    setDataApplied({
      fromTime: dateInputToTime(dataFromInput),
      toTime: dateInputToTime(dataToInput),
    });
  }

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setPage(0);
    setApplied({
      fromTime: dateInputToTime(fromInput),
      toTime: dateInputToTime(toInput),
      errorsOnly: errorsOnlyInput,
      action: actionInput || undefined,
    });
  }

  return (
    <section className="space-y-4">
      {confirmDialog}
      <Link
        to={"/account/apps" + search}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft size={14} aria-hidden /> {t("audit.backToApps")}
      </Link>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-muted">
            {t("audit.accessDetails")}
            {accessId === selfAccessId && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs normal-case tracking-normal text-primary">
                {t("common.thisSession")}
              </span>
            )}
          </span>
          {details && delegationManagedKind(details) == null && (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={revoking}
              className="inline-flex items-center gap-1 rounded border border-danger px-3 py-1 text-sm text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              <XCircle size={14} aria-hidden />
              {revoking ? t("audit.revoking") : t("audit.revoke")}
            </button>
          )}
        </div>
        {revokeError && <Alert>{revokeError}</Alert>}
        {details && delegationManagedKind(details) != null && (
          <Alert tone="info">
            <Trans
              i18nKey="audit.managedByDelegation"
              components={{ manage: <Link to={"/account/delegation" + search} className="underline" /> }}
            />
          </Alert>
        )}
        {detailsError && <Alert>{detailsError}</Alert>}
        {detailsMissing && (
          <Alert tone="info">
            {t("audit.accessMissing")}
          </Alert>
        )}
        {!details && !detailsMissing && !detailsError && (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        )}
        {details && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Detail label={t("audit.labelName")} value={details.name} />
            <Detail label={t("audit.labelId")} value={details.id} mono />
            <Detail label={t("audit.labelType")} value={details.type} />
            <Detail label={t("audit.labelDevice")} value={details.deviceName} />
            <Detail label={t("audit.labelCreated")} value={fmtTime(details.created)} />
            <Detail label={t("audit.labelCreatedBy")} value={details.createdBy} mono />
            <Detail label={t("audit.labelModified")} value={fmtTime(details.modified)} />
            <Detail label={t("audit.labelModifiedBy")} value={details.modifiedBy} mono />
            <Detail label={t("audit.labelLastUsed")} value={fmtTime(details.lastUsed)} />
            <Detail
              label={t("audit.labelExpires")}
              value={
                details.expires
                  ? fmtTime(details.expires) + (details.expired ? t("audit.expiredSuffix") : "")
                  : t("audit.never")
              }
            />
          </dl>
        )}
        {details?.permissions && details.permissions.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("audit.permissions")}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-divider text-xs text-muted">
                    <th className="py-1 pr-4 font-normal">{t("audit.colScope")}</th>
                    <th className="py-1 font-normal">{t("audit.colLevel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {details.permissions.map((p, i) => (
                    <tr key={i} className="border-b border-divider/50">
                      <td className="py-1 pr-4 font-mono text-xs">
                        {p.streamId ?? p.tag ?? p.feature ?? "?"}
                      </td>
                      <td className="py-1">{p.level ?? p.setting ?? "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {details?.clientData && consentMessage(details.clientData) !== null && (
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("audit.consentMessage")}</div>
            <div className="rounded border border-divider p-3">
              <MarkdownLite text={consentMessage(details.clientData)!} />
            </div>
          </div>
        )}
        {details?.clientData &&
          Object.keys(details.clientData).filter((k) => k !== CONSENT_KEY).length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("audit.clientData")}</div>
              <pre className="overflow-x-auto rounded bg-body p-2 font-mono text-xs">
                {JSON.stringify(
                  Object.fromEntries(
                    Object.entries(details.clientData).filter(([k]) => k !== CONSENT_KEY),
                  ),
                  null,
                  2,
                )}
              </pre>
            </div>
          )}
      </Card>

      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">{t("audit.auditTrail")}</div>
        <form onSubmit={applyFilters} className="mb-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("common.from")}</span>
            <input
              type="datetime-local"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("common.to")}</span>
            <input
              type="datetime-local"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("audit.action")}</span>
            <select
              value={actionInput}
              onChange={(e) => setActionInput(e.target.value)}
              className="rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary"
            >
              <option value="">{t("audit.allActions")}</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 pb-1">
            <input
              type="checkbox"
              checked={errorsOnlyInput}
              onChange={(e) => setErrorsOnlyInput(e.target.checked)}
            />
            <span className="text-xs">{t("audit.errorsOnly")}</span>
          </label>
          <Button type="submit" disabled={busy} className="w-auto">
            {t("common.apply")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => void loadAudit()}
            className="w-auto"
          >
            <RefreshCw size={14} aria-hidden className="mr-1" /> {t("common.refresh")}
          </Button>
        </form>

        {auditError && <Alert>{auditError}</Alert>}
        {rows === null && !auditError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {rows?.length === 0 && !auditError && (
          <p className="text-sm text-muted">{t("audit.noEntries")}</p>
        )}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-divider text-xs text-muted">
                  <th className="py-1 pr-4 font-normal">{t("audit.colTime")}</th>
                  <th className="py-1 pr-4 font-normal">{t("audit.colAction")}</th>
                  <th className="py-1 pr-4 font-normal">{t("audit.colStatus")}</th>
                  <th className="py-1 pr-4 font-normal">{t("audit.colSource")}</th>
                  <th className="py-1 font-normal">{t("audit.colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-divider/50 align-top">
                    <td className="whitespace-nowrap py-1 pr-4 text-xs">{fmtTime(e.time)}</td>
                    <td className="py-1 pr-4 font-mono text-xs">{auditAction(e)}</td>
                    <td className="py-1 pr-4">
                      {isAuditError(e) ? (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">
                          {t("audit.statusError")}
                        </span>
                      ) : (
                        <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs text-success">
                          {t("audit.statusOk")}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-4 text-xs">
                      {e.content?.source?.ip ?? "—"}
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
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="w-auto"
          >
            <ChevronLeft size={14} aria-hidden className="mr-1" /> {t("common.previous")}
          </Button>
          <span className="text-xs text-muted">{t("common.page", { page: page + 1 })}</span>
          <Button
            variant="ghost"
            type="button"
            disabled={busy || !hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="w-auto"
          >
            {t("common.next")} <ChevronRight size={14} aria-hidden className="ml-1" />
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          {t("audit.dataHeading")}
        </div>
        <form onSubmit={applyDataFilters} className="mb-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("common.from")}</span>
            <input
              type="datetime-local"
              value={dataFromInput}
              onChange={(e) => setDataFromInput(e.target.value)}
              className="rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("common.to")}</span>
            <input
              type="datetime-local"
              value={dataToInput}
              onChange={(e) => setDataToInput(e.target.value)}
              className="rounded border border-divider bg-card px-2 py-1 text-ink outline-none focus:border-primary"
            />
          </label>
          <Button type="submit" disabled={dataBusy} className="w-auto">
            {t("common.apply")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={dataBusy}
            onClick={() => void loadData()}
            className="w-auto"
          >
            <RefreshCw size={14} aria-hidden className="mr-1" /> {t("common.refresh")}
          </Button>
        </form>

        {dataError && <Alert>{dataError}</Alert>}
        {dataTruncated && (
          <Alert tone="info">
            {t("audit.dataTruncated", { limit: DATA_BATCH_LIMIT })}
          </Alert>
        )}
        {dataRows === null && !dataError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {dataRows?.length === 0 && !dataError && (
          <p className="text-sm text-muted">{t("audit.noData")}</p>
        )}
        {dataRows && dataRows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-divider text-xs text-muted">
                    <th className="py-1 pr-4 font-normal">{t("audit.colTime")}</th>
                    <th className="py-1 pr-4 font-normal">{t("audit.colType")}</th>
                    <th className="py-1 pr-4 font-normal">{t("audit.colStreams")}</th>
                    <th className="py-1 pr-4 font-normal">{t("audit.colRelation")}</th>
                    <th className="py-1 font-normal">{t("audit.colContent")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(dataPage * PAGE_SIZE, (dataPage + 1) * PAGE_SIZE).map((e) => (
                    <tr key={e.id} className="border-b border-divider/50 align-top">
                      <td className="whitespace-nowrap py-1 pr-4 text-xs">{fmtTime(e.time)}</td>
                      <td className="py-1 pr-4 font-mono text-xs">
                        {e.type}
                        {e.trashed ? t("audit.trashedSuffix") : ""}
                      </td>
                      <td className="py-1 pr-4 font-mono text-xs">
                        {(e.streamIds ?? []).join(", ")}
                      </td>
                      <td className="whitespace-nowrap py-1 pr-4 text-xs">
                        {t(RELATION_KEYS[eventRelation(e, accessId!)])}
                      </td>
                      <td
                        className="max-w-[14rem] truncate py-1 font-mono text-xs"
                        title={contentText(e)}
                      >
                        {contentText(e)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                variant="ghost"
                type="button"
                disabled={dataBusy || dataPage === 0}
                onClick={() => setDataPage((p) => Math.max(0, p - 1))}
                className="w-auto"
              >
                <ChevronLeft size={14} aria-hidden className="mr-1" /> {t("common.previous")}
              </Button>
              <span className="text-xs text-muted">
                {t("common.pageOf", { page: dataPage + 1, total: Math.max(1, Math.ceil(dataRows.length / PAGE_SIZE)) })}
                {" · "}
                {t("audit.eventCount", { count: dataRows.length })}
              </span>
              <Button
                variant="ghost"
                type="button"
                disabled={dataBusy || (dataPage + 1) * PAGE_SIZE >= dataRows.length}
                onClick={() => setDataPage((p) => p + 1)}
                className="w-auto"
              >
                {t("common.next")} <ChevronRight size={14} aria-hidden className="ml-1" />
              </Button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function contentText(e: DataEvent): string {
  if (e.content === undefined || e.content === null) return "—";
  const s = typeof e.content === "string" ? e.content : JSON.stringify(e.content);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

function detailText(e: AuditEvent): string {
  if (isAuditError(e)) {
    return [e.content?.id, e.content?.message].filter(Boolean).join(": ") || "—";
  }
  return e.content?.query && Object.keys(e.content.query).length > 0
    ? JSON.stringify(e.content.query)
    : "—";
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-3 border-b border-divider/40 py-1 sm:block sm:border-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : ""}>{value}</dd>
    </div>
  );
}
