import type { ReactNode } from "react";
import { Alert } from "../ui";
import { AppIcon } from "../AppIcon";
import type { CatalogIcon } from "../../lib/appCatalog";
import type { ConsentEntry } from "../../lib/consent";
import { PermissionList } from "./PermissionList";
import { ConsentActions } from "./ConsentActions";

export interface ConsentPanelProps {
  /** The requesting app: name and icon from the operator's catalog when it knows the app. */
  app: { name: string; icon?: CatalogIcon | null; description?: string | null };
  /** Element id on the app name (for pages that expose it). */
  appNameId?: string;
  /** Extra heading under the app (e.g. an OAuth2 offer title and description). */
  title?: ReactNode;
  /** Line introducing the list. */
  requesting?: ReactNode;
  /** Rendered before the permission rows (e.g. the app's own consent message). */
  consentText?: ReactNode;
  entries: ConsentEntry[];
  /** Tick state when the user may choose; omitted for an all-or-nothing list. */
  flags?: boolean[];
  onToggle?: (index: number, checked: boolean) => void;
  idPrefix?: string;
  /** Rendered right after the permission rows. */
  afterList?: ReactNode;
  /** Explanation of what ticking means, under the list. */
  choiceHint?: ReactNode;
  expireAfterSeconds?: number | null;
  /** Notice that the app already holds a different access. */
  mismatchWarning?: ReactNode;
  busy: "accept" | "refuse" | null;
  disabled?: boolean;
  /** Receives the tick state at the moment of Accept (undefined when all-or-nothing). */
  onAccept: (flags?: boolean[]) => void;
  onRefuse: () => void;
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
  title,
  requesting = "is requesting permission:",
  consentText,
  entries,
  flags,
  onToggle,
  idPrefix,
  afterList,
  choiceHint,
  expireAfterSeconds,
  mismatchWarning,
  busy,
  disabled,
  onAccept,
  onRefuse,
  labels,
  acceptId,
  refuseId,
  children,
}: ConsentPanelProps) {
  return (
    <>
      <h1 className="mb-2 flex items-center gap-2 text-2xl">
        <AppIcon icon={app.icon ?? null} />
        <strong id={appNameId}>{app.name}</strong>
      </h1>
      {app.description != null && <p className="mb-2 text-sm text-muted">{app.description}</p>}
      {title}
      <p className="mb-2 text-sm">{requesting}</p>
      {consentText}
      <PermissionList entries={entries} flags={flags} onToggle={onToggle} idPrefix={idPrefix} />
      {afterList}
      {choiceHint}
      {expireAfterSeconds != null && (
        <p className="mb-2 text-sm">
          <strong>{labels?.expiresAfter ?? "Expires after:"}</strong> {expireAfterSeconds}s
        </p>
      )}
      {mismatchWarning != null && <Alert tone="info">{mismatchWarning}</Alert>}
      {children}
      <ConsentActions
        busy={busy}
        disabled={disabled}
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
