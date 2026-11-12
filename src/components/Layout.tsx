import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NO_BACK_TO, inPopupOrFrame, parseBackTo } from "../lib/backTo";
import { Logo } from "../brand";
import DelegatedSessionBanner from "./DelegatedSessionBanner";
import ThemeToggle from "./ThemeToggle";

/**
 * App shell. Renders the brand header with the theme toggle and, when the opener passed
 * `backUrl`/`backLabel`, a text-only "Back to {label}" link.
 *
 * Note: this back link is a user-initiated cancel/return — it is independent of
 * the auth-completion `returnURL` / OAuth2 `redirect_uri`, which the auth flow
 * owns separately. It is not shown in a pop-up the app opened, nor in a frame:
 * following it would load the app inside the pop-up or the frame.
 */
export default function Layout({ children }: { children: ReactNode }) {
  const { search, pathname } = useLocation();
  const { t } = useTranslation();
  const backTo = inPopupOrFrame() ? NO_BACK_TO : parseBackTo(search);
  // The account section uses the wide layout; the auth and consent pages keep
  // the narrow column. Widths are the `--layout-*` tokens of src/index.css.
  const wide = isAccountPath(pathname);

  return (
    <div className="min-h-screen bg-body text-ink">
      <header className="flex items-center justify-between border-b border-divider bg-card px-4 py-3">
        <Logo className="h-7 w-auto text-ink" />
        <div className="flex items-center gap-4">
          <ThemeToggle />
          {backTo.url && (
            <a href={backTo.url} className="text-sm text-primary hover:underline">
              {backTo.label ? t("common.backTo", { label: backTo.label }) : t("common.back")}
              {backTo.host && <span className="text-muted"> ({backTo.host})</span>}
            </a>
          )}
        </div>
      </header>
      <DelegatedSessionBanner />
      <main
        className={`mx-auto px-4 py-8 ${wide ? "max-w-(--layout-account-max)" : "max-w-(--layout-narrow-max)"}`}
        data-layout={wide ? "wide" : "narrow"}
      >
        {children}
      </main>
    </div>
  );
}

/** Whether a path belongs to the account section (`/account` and below). */
function isAccountPath(pathname: string): boolean {
  return pathname === "/account" || pathname.startsWith("/account/");
}
