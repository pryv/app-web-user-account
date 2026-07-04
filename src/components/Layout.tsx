import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { parseBackTo } from "../lib/backTo";
import PryvLogo from "./PryvLogo";

/**
 * App shell. Renders the brand header and, when the opener passed
 * `backUrl`/`backLabel`, a "← Back to {label}" affordance.
 *
 * Note: this back link is a user-initiated cancel/return — it is independent of
 * the auth-completion `returnURL` / OAuth2 `redirect_uri`, which the auth flow
 * owns separately.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const { search } = useLocation();
  const backTo = parseBackTo(search);

  return (
    <div className="min-h-screen bg-body text-ink">
      <header className="flex items-center justify-between border-b border-divider bg-card px-4 py-3">
        <PryvLogo className="h-7 w-auto text-ink" />
        {backTo.url && (
          <a href={backTo.url} className="text-sm text-primary hover:underline">
            ← Back{backTo.label ? ` to ${backTo.label}` : ""}
            {backTo.host && <span className="text-muted"> ({backTo.host})</span>}
          </a>
        )}
      </header>
      <main className="mx-auto max-w-md px-4 py-8">{children}</main>
    </div>
  );
}
