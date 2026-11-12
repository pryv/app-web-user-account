import { useTranslation } from "react-i18next";
import type { ClientDataRow } from "../lib/clientDataView";
import { clientDataLabel } from "../lib/clientDataLabels";

/**
 * Client data rows (`lib/clientDataView.ts`) as a definition list: the label
 * (the path as tooltip), then the value as text, a list, "none", or a
 * collapsed raw view. Values are already masked; nothing is made a link.
 */
export function ClientDataList({ rows }: { rows: ClientDataRow[] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {rows.map(({ path, value }) => (
        <div key={path} className="contents">
          <dt className="text-xs text-muted sm:pt-0.5" title={path}>
            {clientDataLabel(path)}
          </dt>
          <dd className="mb-1 min-w-0 break-words sm:mb-0">
            {value === null ? (
              <span className="text-muted">{t("clientData.none")}</span>
            ) : typeof value === "string" ? (
              <span className="break-all">{value}</span>
            ) : Array.isArray(value) ? (
              <ul className="list-inside list-disc">
                {value.map((v, i) => (
                  <li key={i} className="break-all">
                    {v}
                  </li>
                ))}
              </ul>
            ) : (
              <details>
                <summary className="cursor-pointer text-xs text-primary">{t("clientData.raw")}</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-body p-2 font-mono text-xs">
                  {typeof value.raw === "string" ? value.raw : JSON.stringify(value.raw, null, 2)}
                </pre>
              </details>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
