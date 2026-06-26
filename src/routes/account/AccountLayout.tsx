import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../lib/session";

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
    return <Navigate to={`/signin${search}`} replace />;
  }

  function signOut() {
    // Clears localStorage + in-memory Connection. The personal access token
    // remains valid on the server (intentional: the user might want to sign
    // back in immediately). To also revoke server-side, use the Revoke
    // button in /account/apps on the user's own session access.
    setConnection(null);
    navigate("/signin", { replace: true });
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl">Your account</h1>
        <button
          type="button"
          onClick={signOut}
          className="text-sm text-primary hover:underline"
        >
          Sign out
        </button>
      </div>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-pryv-light-gray">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm ${
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
