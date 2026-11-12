import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Card, Button, Alert } from "../../components/ui";
import { useConfirm } from "../../components/ConfirmDialog";
import { useSession } from "../../lib/useSession";
import { signinPath } from "../../lib/sessionPaths";
import { useAsResolution } from "../../lib/useAuditAs";
import { AsGate, AsNotice } from "../../components/AsGate";
import { tNodes } from "../../components/consent/tNodes";
import { ActivityCard } from "./ActivityCard";
import {
  dateInputToTime,
  buildDataGetParams,
  filterEventsByAccess,
  eventRelation,
  accessesWithDeletions,
  findAccess,
  parseAttribution,
  sameAccess,
  DATA_BATCH_LIMIT,
  type AccessDetails,
  type DataEvent,
} from "../../lib/audit";
import { MarkdownLite } from "../../lib/markdownLite";
import { consentMessage } from "../../lib/consentMessage";
import { clientDataRows } from "../../lib/clientDataView";
import { ClientDataList } from "../../components/ClientDataList";
import { delegationManagedKind } from "../../lib/delegation";
import { formatDateTime } from "../../lib/dates";
import { maskCredentials, maskUrlCredentials } from "../../lib/maskCredentials";
import { platformError } from "../../lib/apiError";
import AccessExtras from "../../extensions/AccessExtras";

const PAGE_SIZE = 15;
// One empty list: resetting to it again is no state change (no extra render).
const NO_ACCESSES: AccessDetails[] = [];

const RELATION_KEYS: Record<ReturnType<typeof eventRelation>, string> = {
  created: "audit.relationCreated",
  modified: "audit.relationModified",
  "created + modified": "audit.relationCreatedModified",
};

function fmtTime(t?: number | null): string {
  // No value: a dash (as before).
  return t ? formatDateTime(t) : "\u2014";
}

/**
 * One access: its details, Revoke, an Activity summary (lifetime counts, last
 * error, 7-day chart, link to its entries in the Audit trail tab) and the data
 * it created or modified. The audit store keeps a per-access stream
 * (`:_audit:access-<id>`) that outlives the access itself, so its activity
 * stays readable even after the access was revoked.
 *
 * One page per access: following a "via" link to another access starts a new
 * page (filters, pages and loads of the previous one do not carry over).
 */
export default function AuditAccess() {
  const { accessId } = useParams<{ accessId: string }>();
  return <AuditAccessPage key={accessId} accessId={accessId} />;
}

function AuditAccessPage({ accessId }: { accessId: string | undefined }) {
  const { t } = useTranslation();
  const { connection, setConnection } = useSession();
  const navigate = useNavigate();
  // Carried on every in-app link so the platform choice (pryvServiceInfoUrl) survives.
  const { search } = useLocation();
  const [confirm, confirmDialog] = useConfirm();

  // `?as=<username>`: read once and resolved before anything loads (lib/useAuditAs).
  const asRes = useAsResolution(search);
  const ready = asRes.ready;

  const [details, setDetails] = useState<AccessDetails | null>(null);
  // Every access of the account, removed ones included: resolves "created by" / "modified by".
  const [accessList, setAccessList] = useState<AccessDetails[]>(NO_ACCESSES);
  const [detailsMissing, setDetailsMissing] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selfAccessId, setSelfAccessId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Self-access marker: warn before the user revokes the very access their
  // session runs on (revoking it signs them out).
  useEffect(() => {
    if (!connection || !ready) return;
    connection
      .accessInfo()
      .then((info: unknown) => {
        const id = (info as { id?: string } | null)?.id;
        if (id) setSelfAccessId(id);
      })
      .catch(() => {
        /* non-fatal — UX helper only */
      });
  }, [connection, ready]);

  async function revoke() {
    if (!connection || !accessId) return;
    const isSelf = sameAccess(accessId, selfAccessId);
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
      setRevokeError(shownError(err, t("audit.errorRevoke")));
      setRevoking(false);
    }
  }

  // Access details: accesses.get includes expired ones, and the deletion
  // records of removed ones, so a deleted access still shows by name (its
  // audit trail outlives it).
  useEffect(() => {
    if (!connection || !accessId || !ready) return;
    // A new connection (the pages now act for another account) or access id:
    // nothing from the previous load may stay on screen next to the new one.
    setDetails(null);
    setAccessList(NO_ACCESSES);
    setDetailsMissing(false);
    setDetailsError(null);
    let cancelled = false;
    void (async () => {
      try {
        const [res] = (await connection.api([
          { method: "accesses.get", params: { includeExpired: true, includeDeletions: true } },
        ])) as Array<{
          accesses?: AccessDetails[];
          accessDeletions?: AccessDetails[];
          error?: { message: string };
        }>;
        if (cancelled) return;
        if (res?.error) throw new Error(res.error.message);
        const list = accessesWithDeletions(res ?? {});
        setAccessList(list);
        const found = findAccess(list, accessId);
        if (found) {
          setDetails(found);
        } else {
          setDetailsMissing(true);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setDetailsError(shownError(err, t("audit.errorLoadDetails")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, accessId, ready, t]);

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
    if (!connection || !accessId || !ready) return;
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
      setDataError(shownError(err, t("audit.errorLoadData")));
      setDataRows([]);
    } finally {
      setDataBusy(false);
    }
  }, [connection, accessId, dataApplied, ready, t]);

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

  const clientRows = clientDataRows(details?.clientData);

  const backLink = (
    <Link
      to={"/account/apps" + search}
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
    >
      <ArrowLeft size={14} aria-hidden /> {t("audit.backToApps")}
    </Link>
  );

  // Until it is decided which account the page shows: the back link and the card only.
  if (!ready) return <AsGate as={asRes}>{backLink}</AsGate>;

  return (
    <section className="space-y-4">
      {confirmDialog}
      {backLink}
      <AsNotice state={asRes.state} />

      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-wide text-muted">
            {t("audit.accessDetails")}
            {sameAccess(accessId, selfAccessId) && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs normal-case tracking-normal text-primary">
                {t("common.thisSession")}
              </span>
            )}
            {details?.deleted != null && (
              <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs normal-case tracking-normal text-danger">
                {t("audit.removedBadge")}
              </span>
            )}
          </span>
          {details && details.deleted == null && delegationManagedKind(details) == null && (
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
        {details?.deleted != null && (
          <Alert tone="info">{t("audit.accessRemoved", { date: fmtTime(details.deleted) })}</Alert>
        )}
        {details && details.deleted == null && delegationManagedKind(details) != null && (
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
            <AttributionDetail
              label={t("audit.labelCreatedBy")}
              value={details.createdBy}
              accesses={accessList}
              search={search}
            />
            <Detail label={t("audit.labelModified")} value={fmtTime(details.modified)} />
            <AttributionDetail
              label={t("audit.labelModifiedBy")}
              value={details.modifiedBy}
              accesses={accessList}
              search={search}
            />
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
        {clientRows.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">{t("audit.clientData")}</div>
            {/* Masked rows: token-bearing endpoints (a consent grant's counterparty) shown without their token. */}
            <ClientDataList rows={clientRows} />
          </div>
        )}
      </Card>

      {connection && details && (
        <AccessExtras
          connection={connection}
          access={details}
          isSelf={sameAccess(details.id, selfAccessId)}
        />
      )}

      {connection && accessId && (
        <ActivityCard connection={connection} accessId={accessId} usage={details?.usage} search={search} />
      )}

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

/**
 * An error as the page shows it: the platform's own message (never a client
 * wrapper's, which could embed the call's parameters), any URL's token masked.
 */
function shownError(err: unknown, fallback: string): string {
  return maskUrlCredentials(platformError(err, fallback).message);
}

function contentText(e: DataEvent): string {
  if (e.content === undefined || e.content === null) return "—";
  const content = maskCredentials(e.content);
  const s = typeof content === "string" ? content : JSON.stringify(content);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

/**
 * "Created by" / "Modified by": the access the stored reference names, as
 * "via <its name>" linking to its own page (marked when removed), with the
 * caller label the call carried. The raw reference when it names no access
 * the account lists.
 */
function AttributionDetail({
  label,
  value,
  accesses,
  search,
}: {
  label: string;
  value?: string | null;
  accesses: AccessDetails[];
  search: string;
}) {
  const { t } = useTranslation();
  if (!value) return null;
  const parent = findAccess(accesses, value);
  if (!parent) return <Detail label={label} value={maskUrlCredentials(value)} mono />;
  const { callerId } = parseAttribution(value);
  const link = (
    <Link
      to={`/account/audit-access/${encodeURIComponent(parent.id)}${search}`}
      className="text-primary underline"
      title={maskUrlCredentials(value)}
    >
      {parent.name || parent.id}
    </Link>
  );
  return (
    <div className="flex justify-between gap-3 border-b border-divider/40 py-1 sm:block sm:border-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        {tNodes(parent.deleted != null ? "audit.viaRemoved" : "audit.via", { name: link })}
        {callerId && (
          <span className="block break-all text-xs text-muted" title={t("audit.callerIdHint")}>
            {t("audit.callerId", { callerId: maskUrlCredentials(callerId) })}
          </span>
        )}
      </dd>
    </div>
  );
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
