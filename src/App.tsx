import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import PagePlaceholder from "./components/PagePlaceholder";
import SignIn from "./routes/SignIn";
import Register from "./routes/Register";
import ResetPassword from "./routes/ResetPassword";
import ChangePassword from "./routes/ChangePassword";
import MfaChallenge from "./routes/MfaChallenge";
import CmcApprove from "./routes/CmcApprove";
import AccountLayout from "./routes/account/AccountLayout";
import Profile from "./routes/account/Profile";
import Security from "./routes/account/Security";
import ConnectedApps from "./routes/account/ConnectedApps";
import DataRights from "./routes/account/DataRights";

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
        <Route path="/register" element={<Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/change-password" element={<ChangePassword />} />

        {/* Hybrid MFA challenge — also launchable standalone by a CLI */}
        <Route path="/mfa-challenge" element={<MfaChallenge />} />

        {/* CMC approval — triggerable by an app without a personal token */}
        <Route path="/cmc/approve" element={<CmcApprove />} />

        {/* Self-service account management (subject) */}
        <Route path="/account" element={<AccountLayout />}>
          <Route index element={<Navigate to="/account/profile" replace />} />
          <Route path="profile" element={<Profile />} />
          <Route path="security" element={<Security />} />
          <Route path="apps" element={<ConnectedApps />} />
          <Route path="data" element={<DataRights />} />
        </Route>

        <Route path="/" element={<Navigate to="/signin" replace />} />
        <Route path="*" element={<PagePlaceholder title="Not found" description="This page does not exist." />} />
      </Routes>
    </Layout>
  );
}
