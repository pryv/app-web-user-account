import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../../lib/session";

const TABS = [
  { to: "/account/profile", label: "Profile" },
  { to: "/account/security", label: "Security" },
  { to: "/account/apps", label: "Connected apps" },
  { to: "/account/data", label: "Your data" },
];

/**
 * Account-management shell (signed-in subject only). Redirects to sign-in when
 * there is no active session.
 */
export default function AccountLayout() {
  const { connection } = useSession();
  const { search } = useLocation();

  if (!connection) {
    return <Navigate to={`/signin${search}`} replace />;
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl">Your account</h1>
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
