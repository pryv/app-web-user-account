import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { syncLocaleFromAccount } from "../../i18n";
import { useSession } from "../../lib/useSession";
import { signinPath } from "../../lib/sessionPaths";
import { useAccountTabs } from "../../accountTabs";
import { signInReturnOutcome } from "../../lib/accountActsGate";
import { ReturnNotice } from "../../components/consent/ReturnNotice";

/**
 * Account-management shell (signed-in subject only). Redirects to sign-in when
 * there is no active session. Hosts the sign-out affordance so any page under
 * /account can rely on it being present without re-implementing it. After a
 * sign-in whose `returnURL` the operator's return policy did not follow, it
 * shows the link back (with its host) or the notice, as the hand-off pages do.
 */
export default function AccountLayout() {
  const { t } = useTranslation();
  const { connection, setConnection } = useSession();
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const tabs = useAccountTabs();

  // Adopt the account's language once per session, whichever account page
  // the user lands on (a `?lang=` on the link still wins).
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => connection.api([{ method: "account.get", params: {} }]))
      .then((results) => {
        const [res] = results as Array<{ account?: { language?: string } }>;
        if (!cancelled) syncLocaleFromAccount(res?.account?.language);
      })
      .catch(() => {
        // Keep the current language.
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  if (!connection) {
    // Come back to the page that was asked for once signed in.
    return <Navigate to={signinPath(search, pathname + search)} replace />;
  }

  function signOut() {
    // Clears localStorage + in-memory Connection. The personal access token
    // remains valid on the server (intentional: the user might want to sign
    // back in immediately). To also revoke server-side, use the Revoke
    // button in /account/apps on the user's own session access.
    //
    // Order matters: navigate FIRST so we leave the /account route before
    // setConnection(null) re-renders AccountLayout with connection===null,
    // which would otherwise fire its own <Navigate to={signinPath()}> with
    // localStorage already cleared — losing the pryvServiceInfoUrl on the
    // redirect.
    const target = signinPath(search);
    navigate(target, { replace: true });
    setConnection(null);
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl">{t("account.title")}</h1>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <LogOut size={14} aria-hidden /> {t("account.signOut")}
        </button>
      </div>
      {/* Below lg: one row of tabs that scrolls sideways (never wraps). From lg:
          the nav is a vertical list in the left column, the page beside it. */}
      <div className="lg:grid lg:grid-cols-[var(--layout-nav-width)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav
          aria-label={t("account.navAriaLabel")}
          className="-mx-4 mb-6 flex overflow-x-auto whitespace-nowrap border-b border-divider px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:whitespace-normal lg:border-b-0 lg:border-l lg:px-0"
        >
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/account/${tab.path}${search}`}
              className={({ isActive }) =>
                `-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors lg:mb-0 lg:-ml-px lg:border-b-0 lg:border-l-2 ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:text-ink"
                }`
              }
            >
              {t(tab.label, { defaultValue: tab.label })}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0" data-testid="account-content">
          <ReturnNotice outcome={signInReturnOutcome(state)} stayKey="signin.returnNotAllowed" />
          <Outlet />
        </div>
      </div>
    </div>
  );
}
