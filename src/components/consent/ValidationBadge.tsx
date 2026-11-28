import { useTranslation } from "react-i18next";
import { BadgeCheck, ShieldCheck, ShieldAlert } from "lucide-react";
import type { ClientValidation } from "../../lib/oauth2Flow";
import { tNodes } from "./tNodes";

const TONE: Record<ClientValidation["level"], string> = {
  // The success and info colours are too light for text on a light card: frame and icon only.
  appValidated: "border-success/60 bg-success/10 text-ink",
  publisherValidated: "border-info/60 bg-info/10 text-ink",
  nonValidated: "border-danger/40 bg-danger/10 text-danger-ink",
};

/** The icon's own colour, where the badge's text does not carry the tone. */
const ICON_TONE: Partial<Record<ClientValidation["level"], string>> = {
  appValidated: "text-success",
  publisherValidated: "text-info",
};

const ICON = {
  appValidated: BadgeCheck,
  publisherValidated: ShieldCheck,
  nonValidated: ShieldAlert,
} as const;

/**
 * Who vouches for the requesting app, as the core decided it: the badge
 * ("App Validated", "Publisher Validated", "Non-Validated"), a one-line
 * explanation and, for a Non-Validated app, a caution line. The texts are
 * this app's catalog (`oauth.validation.*`), never anything the app sent.
 * Renders nothing without a validation block (a core that does not say).
 */
export function ValidationBadge({ validation }: { validation: ClientValidation | null | undefined }) {
  const { t } = useTranslation();
  if (validation == null) return null;
  const { level, publisher } = validation;
  const Icon = ICON[level];
  // The publisher's name is isolated for bidirectional text inside the sentence.
  const explain =
    level === "publisherValidated" && publisher?.name != null
      ? tNodes("oauth.validation.publisherValidatedExplainNamed", { name: <bdi>{publisher.name}</bdi> })
      : t(`oauth.validation.${level}Explain`);
  return (
    <div id="oauthValidation" data-level={level} className="mb-2 text-sm">
      <p className="mb-1 flex flex-wrap items-center gap-2">
        <span
          id="oauthValidationBadge"
          className={`inline-flex items-center gap-1 rounded border px-2 py-[1px] text-xs font-medium ${TONE[level]}`}
        >
          <Icon size={14} aria-hidden className={ICON_TONE[level]} />
          {t(`oauth.validation.${level}`)}
        </span>
        <span id="oauthValidationExplain" className="text-muted">{explain}</span>
      </p>
      {level === "nonValidated" && (
        <p id="oauthValidationCaution" role="note" className="text-danger-ink">
          {t("oauth.validation.nonValidatedCaution")}
        </p>
      )}
    </div>
  );
}
