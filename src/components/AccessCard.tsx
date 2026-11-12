import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PryvConnection } from "../lib/session";
import { entryNaming, type OAuthAccessLike } from "../lib/oauthClient";
import { useAccessNaming } from "../extensions/accessNaming";
import { clientDataRows } from "../lib/clientDataView";
import { formatDate, formatDateTime } from "../lib/dates";
import { AppIcon } from "./AppIcon";
import { ClientDataList } from "./ClientDataList";

/** The fields of an access the card reads (`accesses.get`). */
export interface AccessCardAccess extends OAuthAccessLike {
  id: string;
  name?: string;
  type?: string;
  permissions?: unknown[];
  created?: number;
  lastUsed?: number;
  expires?: number | null;
  expired?: boolean;
  clientData?: Record<string, unknown> | null;
  /** Set on a removed access (a deletion record). */
  deleted?: number;
}

const BADGE = "ml-2 rounded px-1.5 py-0.5 text-xs font-normal";

/**
 * One access, as Security (personal sessions) and Connected apps (apps, with
 * their OAuth sessions folded under the grant) show it: icon slot, name (and
 * host), badges, kind and counts, dates, the client data behind a closed
 * disclosure, and the Details link to the access page (carrying `search`).
 *
 * The name comes from `src/extensions/accessNaming.ts` when a fork names the
 * access, else from `entryNaming`.
 */
export function AccessCard({
  access,
  sessions = [],
  isSelf,
  kindLabel,
  search,
  connection,
}: {
  access: AccessCardAccess;
  /** OAuth sessions folded under a grant; none for a single access. */
  sessions?: AccessCardAccess[];
  isSelf: boolean;
  /** The kind shown in the meta line (a delegation role); default: the access type. */
  kindLabel?: string;
  /** The current query string, appended to the Details link. */
  search: string;
  connection: PryvConnection | null;
}) {
  const { t } = useTranslation();
  const entry = { access, sessions };
  const custom = useAccessNaming(connection, entry);
  const naming = custom ?? entryNaming(entry);
  const rows = clientDataRows(access.clientData);

  const meta = [
    kindLabel ?? access.type ?? t("accessCard.typeApp"),
    Array.isArray(access.permissions) && access.type !== "personal"
      ? t("accessCard.permissions", { count: access.permissions.length })
      : null,
    sessions.length > 0 ? t("accessCard.sessions", { count: sessions.length }) : null,
  ].filter((part): part is string => part != null);

  return (
    <article className="rounded-lg border border-divider bg-card p-4" data-testid="access-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {naming.icon != null && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <AppIcon icon={naming.icon} size="sm" />
            </span>
          )}
          <div className="min-w-0">
            <div className="break-words font-medium">
              <span className="accessName">{naming.label}</span>
              {naming.host != null && (
                <span className="accessHost ml-2 text-xs font-normal text-muted">{naming.host}</span>
              )}
              {isSelf && <span className={`${BADGE} bg-primary/10 text-primary`}>{t("common.thisSession")}</span>}
              {access.expired === true && (
                <span className={`${BADGE} bg-warning/10 text-warning`}>{t("accessCard.expired")}</span>
              )}
              {access.deleted != null && (
                <span className={`${BADGE} bg-danger/10 text-danger`}>{t("accessCard.removed")}</span>
              )}
            </div>
            <div className="text-xs text-muted">{meta.join(" · ")}</div>
            <div className="text-xs text-muted" data-testid="access-card-dates">
              {access.created != null && <>{t("accessCard.created", { date: formatDate(access.created) })} · </>}
              {access.lastUsed
                ? t("accessCard.lastUsed", { date: formatDateTime(access.lastUsed) })
                : t("accessCard.neverUsed")}
              {" · "}
              {access.expires
                ? t("accessCard.expires", { date: formatDate(access.expires) })
                : t("accessCard.never")}
            </div>
          </div>
        </div>
        <Link
          to={`/account/audit-access/${encodeURIComponent(access.id)}${search}`}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-divider px-3 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ScrollText size={14} aria-hidden />
          {t("accessCard.details")}
        </Link>
      </div>
      {rows.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted">{t("accessCard.clientData")}</summary>
          <div className="mt-2">
            <ClientDataList rows={rows} />
          </div>
        </details>
      )}
    </article>
  );
}
