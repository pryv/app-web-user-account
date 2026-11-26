import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "../ui";
import { AppIcon } from "../AppIcon";
import type { CatalogIcon } from "../../lib/appCatalog";
import type { ConsentEntry } from "../../lib/consent";
import { PermissionList } from "./PermissionList";
import { ConsentActions } from "./ConsentActions";
import { ValidationBadge } from "./ValidationBadge";
import type { ClientValidation } from "../../lib/oauth2Flow";

export interface ConsentPanelProps {
  /** The requesting app: name and icon from the operator's catalog when it knows the app. */
  app: { name: ReactNode; icon?: CatalogIcon | null; description?: string | null };
  /** Element id on the app name (for pages that expose it). */
  appNameId?: string;
  /**
   * The host the app is known by (an OAuth2 client known by its metadata
   * document): shown in its own element next to the name, plain text, never
   * a link; `unicode` (its Unicode form) at most as a tooltip.
   */
  appHost?: { host: string; unicode?: string | null } | null;
  /** Small print right under the app name (e.g. the app's identifier). */
  appNote?: ReactNode;
  /**
   * Who vouches for the app, as the core answered it (OAuth2 offers by
   * reference): shown as a badge with a one-line explanation, plus a caution
   * for a Non-Validated app. Absent or null: no badge (an older core).
   */
  validation?: ClientValidation | null;
  /** Extra heading under the app (e.g. an OAuth2 offer title and description). */
  title?: ReactNode;
  /** Line introducing the list (default: the catalog's "is requesting permission:"). */
  requesting?: ReactNode;
  /** Rendered before the permission rows (e.g. the app's own consent message). */
  consentText?: ReactNode;
  entries: ConsentEntry[];
  /** Tick state when the user may choose; omitted for an all-or-nothing list. */
  flags?: boolean[];
  onToggle?: (index: number, checked: boolean) => void;
  idPrefix?: string;
  /** Replaces the flat permission rows (e.g. the offer's groups, see GroupedPermissionList). */
  permissionList?: ReactNode;
  /** Rendered right after the permission rows. */
  afterList?: ReactNode;
  /** Explanation of what ticking means, under the list. */
  choiceHint?: ReactNode;
  expireAfterSeconds?: number | null;
  /** Notice that the app already holds a different access. */
  mismatchWarning?: ReactNode;
  busy: "accept" | "refuse" | null;
  disabled?: boolean;
  /** Disables Accept only (Reject stays available). */
  acceptDisabled?: boolean;
  /** Receives the tick state at the moment of Accept (undefined when all-or-nothing). */
  onAccept: (flags?: boolean[]) => void;
  onRefuse: () => void;
  /** Overrides of the catalog's Accept, Reject and "Expires after:" texts. */
  labels?: Partial<{ accept: string; refuse: string; expiresAfter: string }>;
  acceptId?: string;
  refuseId?: string;
  /** Error slot, above the actions. */
  children?: ReactNode;
}

/**
 * The consent screen body shared by the access-request and OAuth2 pages:
 * who is asking, what they ask for, and the Accept/Reject pair. Routes keep
 * the wire protocol; this keeps the layout, so a deployment restyles or
 * replaces one component.
 */
export function ConsentPanel({
  app,
  appNameId,
  appHost,
  appNote,
  validation,
  title,
  requesting,
  consentText,
  entries,
  flags,
  onToggle,
  idPrefix,
  permissionList,
  afterList,
  choiceHint,
  expireAfterSeconds,
  mismatchWarning,
  busy,
  disabled,
  acceptDisabled,
  onAccept,
  onRefuse,
  labels,
  acceptId,
  refuseId,
  children,
}: ConsentPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="mb-2 flex flex-wrap items-center gap-2 text-2xl">
        <AppIcon icon={app.icon ?? null} />
        {/* The name is isolated for bidirectional text, so a right-to-left
            name never reorders the host after it; a long name wraps. */}
        <strong id={appNameId} className="min-w-0 break-words">
          <bdi>{app.name}</bdi>
        </strong>
        {appHost != null && (
          <span
            id="consentAppHost"
            dir="ltr"
            className="text-base font-normal text-muted break-all"
            style={{ unicodeBidi: "isolate" }}
            title={appHost.unicode != null && appHost.unicode !== appHost.host ? appHost.unicode : undefined}
          >
            {appHost.host}
          </span>
        )}
      </h1>
      {appNote}
      <ValidationBadge validation={validation} />
      {app.description != null && <p className="mb-2 text-sm text-muted">{app.description}</p>}
      {title}
      <p className="mb-2 text-sm">{requesting ?? t("common.requestingPermission")}</p>
      {consentText}
      {permissionList ?? <PermissionList entries={entries} flags={flags} onToggle={onToggle} idPrefix={idPrefix} />}
      {afterList}
      {choiceHint}
      {expireAfterSeconds != null && (
        <p className="mb-2 text-sm">
          <strong>{labels?.expiresAfter ?? t("consent.expiresAfterLabel")}</strong>{" "}
          {t("consent.expiresAfterSeconds", { seconds: expireAfterSeconds })}
        </p>
      )}
      {mismatchWarning != null && <Alert tone="info">{mismatchWarning}</Alert>}
      {children}
      <ConsentActions
        busy={busy}
        disabled={disabled}
        acceptDisabled={acceptDisabled}
        acceptLabel={labels?.accept}
        refuseLabel={labels?.refuse}
        acceptId={acceptId}
        refuseId={refuseId}
        onAccept={() => onAccept(flags)}
        onRefuse={onRefuse}
      />
    </>
  );
}
