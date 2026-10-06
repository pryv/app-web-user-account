import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "../ui";
import { PermissionList } from "./PermissionList";
import { ConsentActions } from "./ConsentActions";
import { consentEntries, type OfferPermission } from "../../lib/consent";
import type { StreamLabelResolver } from "../../lib/streamLabels";

/** A cross-account messaging offer, as `cmc.readOffer` returns it. */
export interface CmcOfferView {
  requester: { username: string | null; host: string; displayName?: string };
  requestedPermissions: OfferPermission[];
  consent?: Record<string, string>;
  mode: string;
  features?: { chat?: boolean; systemMessaging?: boolean };
}

export interface CmcOfferBlockProps {
  /** The offer, once read. */
  offer: CmcOfferView | null;
  /** The offer is being read. */
  loading: boolean;
  /** Shown above the offer (unreadable link, failed action). */
  error: { message: string; tone: "danger" | "info" } | null;
  /** Display names for the offer's streams. */
  labelFor?: StreamLabelResolver;
  /** Which action is in flight: disables both buttons. */
  busy: "accept" | "refuse" | null;
  /** Disables both buttons. */
  disabled?: boolean;
  /** Disables Approve only (Decline stays available). */
  approveDisabled?: boolean;
  onApprove: () => void;
  onDecline: () => void;
  /**
   * The user's decision, for a page that collects it before acting: the
   * actions are replaced by the decision and a way to change it.
   */
  decided?: "approve" | "decline" | null;
  /** Clears the decision (with `decided`). */
  onChange?: () => void;
  /** Rendered first (a page that lists several offers names each one). */
  heading?: ReactNode;
  /**
   * The account already gave this consent: this text replaces the actions
   * (there is nothing to decide).
   */
  given?: string | null;
  /** Rendered after the permissions, before the actions (e.g. the account has no email address). */
  notice?: ReactNode;
  /**
   * Rendered in place of Approve / Decline when the page cannot offer them
   * (e.g. the signed-in account is not the one expected to answer).
   */
  actionsBlocked?: ReactNode;
}

/**
 * One cross-account offer: who asks (the capability's account, the
 * self-asserted name shown only as its own claim), the requester's consent
 * text, what it asks for, and its own Approve / Decline. Shared by
 * `/cmc-accept` (one offer, acted on at once) and `/auth` (one block per
 * invite of an access request, decided before anything is written).
 *
 * The `@pryv/cmc` accept contract is all-or-nothing, so every entry renders
 * locked.
 */
export function CmcOfferBlock({
  offer,
  loading,
  error,
  labelFor,
  busy,
  disabled = false,
  approveDisabled = false,
  onApprove,
  onDecline,
  decided = null,
  onChange,
  heading,
  given = null,
  notice,
  actionsBlocked,
}: CmcOfferBlockProps) {
  const { t } = useTranslation();
  return (
    <>
      {heading}
      {loading && <p className="mb-4 text-sm text-muted">{t("cmc.loadingOffer")}</p>}
      {error && <Alert tone={error.tone}>{error.message}</Alert>}
      {offer && (
        <>
          <p className="mb-4 text-sm">
            {/* The account comes from the capability itself (verified); the
                display name is what the requester says about itself, so it is
                shown as such and never in place of the account. */}
            <strong data-testid="cmc-requester">
              {offer.requester.username
                ? `${offer.requester.username}@${offer.requester.host}`
                : t("cmc.unidentifiedRequester")}
            </strong>
            {offer.requester.displayName && (
              <span className="text-muted"> {t("cmc.callsItself", { name: offer.requester.displayName })}</span>
            )}{" "}
            {t("cmc.requestingAccess")}
          </p>
          {offer.consent && Object.values(offer.consent)[0] && (
            <p className="mb-4 text-sm text-muted">{Object.values(offer.consent)[0]}</p>
          )}
          <PermissionList entries={consentEntries(offer.requestedPermissions, { labelFor })} />
          {notice}
        </>
      )}
      {given != null ? (
        <p className="text-sm" data-testid="cmc-offer-given">
          {given}
        </p>
      ) : decided != null ? (
        <div className="flex items-center justify-between gap-3 text-sm" data-testid="cmc-offer-decision">
          <span>{decided === "approve" ? t("cmc.inviteWillApprove") : t("cmc.inviteWillDecline")}</span>
          {onChange && (
            <button
              type="button"
              onClick={onChange}
              disabled={disabled}
              className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {t("cmc.inviteChange")}
            </button>
          )}
        </div>
      ) : actionsBlocked != null ? (
        actionsBlocked
      ) : (
        <ConsentActions
          busy={busy}
          disabled={disabled}
          acceptDisabled={approveDisabled}
          acceptLabel={t("cmc.approve")}
          refuseLabel={t("cmc.decline")}
          onAccept={onApprove}
          onRefuse={onDecline}
        />
      )}
    </>
  );
}
