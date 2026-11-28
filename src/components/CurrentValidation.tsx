import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ValidationLevel } from "../lib/oauth2Flow";
import { validationChange, type CurrentValidation } from "../lib/currentValidation";

/**
 * The validation level stamped at consent next to the app's current one (both
 * named from this app's catalog, `oauth.validation.*`), and a notice when the
 * app is no longer served or its level changed since. Renders nothing without
 * a current level (a core that does not answer, or an app it does not know).
 */
export function CurrentValidationLine({
  stamped,
  current,
}: {
  stamped: ValidationLevel | null;
  current: CurrentValidation | null;
}) {
  const { t } = useTranslation();
  if (current == null) return null;
  const change = validationChange(stamped, current);
  const warn = change === "notServed" || change === "lowered";
  return (
    <div className="text-xs" data-testid="current-validation">
      <div className="text-muted">
        {stamped != null && (
          <>
            {t("oauth.validation.atConsent", { level: t(`oauth.validation.${stamped}`) })}
            {" · "}
          </>
        )}
        <span data-testid="current-validation-level">
          {t("oauth.validation.current", { level: t(`oauth.validation.${current.level}`) })}
        </span>
      </div>
      {change != null && (
        <p
          role={warn ? "alert" : undefined}
          className={warn ? "mt-1 flex items-start gap-1 text-ink" : "mt-1 text-muted"}
          data-testid="current-validation-notice"
        >
          {/* The warning colour is too light for text on a light card: the icon carries it. */}
          {warn && <AlertTriangle size={12} aria-hidden className="mt-[2px] shrink-0 text-warning" />}
          <span>{t(`oauth.validation.notice_${change}`)}</span>
        </p>
      )}
    </div>
  );
}
