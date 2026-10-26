import { useTranslation } from "react-i18next";
import type { ReturnOutcome } from "../../lib/returnTarget";

/**
 * After a hand-off page answered and did not leave by itself (the operator's
 * return policy, see returnTarget.ts): a link back to the app, showing its
 * host, for `confirm`; a short notice for `stay` (`stayKey`, the catalog key
 * of its wording, defaults to the hand-off pages' one).
 */
export function ReturnNotice({
  outcome,
  stayKey = "cmc.returnNotAllowed",
}: {
  outcome: ReturnOutcome | null;
  stayKey?: string;
}) {
  // (`follow` never reaches here: the page has left.)
  const { t } = useTranslation();
  if (outcome?.kind === "confirm") {
    // `noreferrer`: the other origin is not told which page the user came from.
    return (
      <p className="mb-2 text-sm">
        <a href={outcome.href} rel="noreferrer" className="text-primary hover:underline" data-testid="return-link">
          {t("cmc.returnTo", { host: outcome.host })}
        </a>
      </p>
    );
  }
  if (outcome?.kind === "stay") {
    return <p className="mb-2 text-sm" data-testid="return-refused">{t(stayKey)}</p>;
  }
  return null;
}
