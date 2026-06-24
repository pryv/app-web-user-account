import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { parseBackTo } from "../lib/backTo";

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
      <header className="flex items-center justify-between border-b border-pryv-light-gray bg-white px-4 py-3">
        <span className="font-heading text-lg font-medium text-pryv-red">Pryv</span>
        {backTo.url && (
          <a href={backTo.url} className="text-sm text-primary hover:underline">
            ← Back{backTo.label ? ` to ${backTo.label}` : ""}
          </a>
        )}
      </header>
      <main className="mx-auto max-w-md px-4 py-8">{children}</main>
    </div>
  );
}
