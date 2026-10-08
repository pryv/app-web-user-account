import { useTranslation } from "react-i18next";
import type { ReturnOutcome } from "../../lib/returnTarget";

/**
 * After a hand-off page answered and did not leave by itself (the operator's
 * return policy, see returnTarget.ts): a link back to the app, showing its
 * host, for `confirm`; a short notice for `stay`.
 */
export function ReturnNotice({ outcome }: { outcome: ReturnOutcome | null }) {
  // (`follow` never reaches here: the page has left.)
  const { t } = useTranslation();
  if (outcome?.kind === "confirm") {
    return (
      <p className="mb-2 text-sm">
        <a href={outcome.href} className="text-primary hover:underline" data-testid="return-link">
          {t("cmc.returnTo", { host: outcome.host })}
        </a>
      </p>
    );
  }
  if (outcome?.kind === "stay") {
    return <p className="mb-2 text-sm" data-testid="return-refused">{t("cmc.returnNotAllowed")}</p>;
  }
  return null;
}
