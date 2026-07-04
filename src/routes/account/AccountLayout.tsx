import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useSession, signinPath } from "../../lib/session";

const TABS = [
  { to: "/account/profile", label: "Profile" },
  { to: "/account/security", label: "Security" },
  { to: "/account/apps", label: "Connected apps" },
  { to: "/account/data", label: "Your data" },
];

/**
 * Account-management shell (signed-in subject only). Redirects to sign-in when
 * there is no active session. Hosts the sign-out affordance so any page under
 * /account can rely on it being present without re-implementing it.
 */
export default function AccountLayout() {
  const { connection, setConnection } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();

  if (!connection) {
    return <Navigate to={signinPath(search)} replace />;
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
        <h1 className="text-2xl">Your account</h1>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <LogOut size={14} aria-hidden /> Sign out
        </button>
      </div>
      <nav
        aria-label="Account sections"
        className="mb-6 flex flex-wrap gap-1 border-b border-divider"
      >
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to + search}
            className={({ isActive }) =>
              `-mb-px flex-1 border-b-2 px-3 py-2 text-center text-sm transition-colors sm:flex-none ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-ink"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
