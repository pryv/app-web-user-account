import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import PagePlaceholder from "./components/PagePlaceholder";
import SignIn from "./routes/SignIn";

/**
 * Route map for the user-account app. Each route is a placeholder for now; the
 * navigation structure is in place so flows can be filled in incrementally.
 *
 * Auth flows (sign-in, register, password) preserve the existing query/redirect
 * contract — the auth-completion `returnURL` is owned by those flows and is NOT
 * the same as the `backUrl` cancel affordance handled by the Layout.
 */
export default function App() {
  return (
    <Layout>
      <Routes>
        {/* Auth flows */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/register" element={<PagePlaceholder title="Create account" description="Register a new Pryv account." />} />
        <Route path="/reset-password" element={<PagePlaceholder title="Reset password" description="Request a password reset link." />} />
        <Route path="/change-password" element={<PagePlaceholder title="Change password" description="Set a new password." />} />

        {/* Hybrid MFA challenge — also launchable standalone by a CLI */}
        <Route path="/mfa-challenge" element={<PagePlaceholder title="Verify it's you" description="Complete the multi-factor challenge to continue." />} />

        {/* CMC approval — triggerable by an app without a personal token */}
        <Route path="/cmc/approve" element={<PagePlaceholder title="Approve request" description="Review and approve a cross-account request." />} />

        {/* Self-service account management (subject) */}
        <Route path="/account" element={<PagePlaceholder title="Your account" description="Manage your profile, security, connected apps and data." />} />
        <Route path="/account/profile" element={<PagePlaceholder title="Profile" description="Emails, language, password." />} />
        <Route path="/account/security" element={<PagePlaceholder title="Security" description="Multi-factor authentication and active sessions." />} />
        <Route path="/account/apps" element={<PagePlaceholder title="Connected apps" description="Review scopes and revoke access." />} />
        <Route path="/account/data" element={<PagePlaceholder title="Your data" description="Export your data or delete your account." />} />

        <Route path="/" element={<Navigate to="/signin" replace />} />
        <Route path="*" element={<PagePlaceholder title="Not found" description="This page does not exist." />} />
      </Routes>
    </Layout>
  );
}
