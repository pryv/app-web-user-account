import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import PagePlaceholder from "./components/PagePlaceholder";
import SignIn from "./routes/SignIn";
import Register from "./routes/Register";
import ResetPassword from "./routes/ResetPassword";
import ChangePassword from "./routes/ChangePassword";
import MfaChallenge from "./routes/MfaChallenge";
import CmcApprove from "./routes/CmcApprove";
import CmcScopeUpdate from "./routes/CmcScopeUpdate";
import AccountLayout from "./routes/account/AccountLayout";
import Profile from "./routes/account/Profile";
import Security from "./routes/account/Security";
import ConnectedApps from "./routes/account/ConnectedApps";
import DataRights from "./routes/account/DataRights";

/** Internal redirect that forwards the current `?…` query through. */
function NavigatePreservingSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
}

/**
 * Drop-in placeholder for the access-request and OAuth2 authorize flows.
 * The legacy app-web-auth3 ships them as `/auth` (`Authorization.vue`) and
 * `/oauth2-authorize` (`OAuth2Authorize.vue`). Re-homing them into this
 * React app is tracked separately under the OAuth2 consent UI work. Until
 * that lands, existing operators landing here see a clear explanation
 * rather than a silent redirect, and the route exists so the URL contract
 * holds.
 */
function PendingConsentTrack({ title }: { title: string }) {
  return (
    <PagePlaceholder
      title={title}
      description="This page is the OAuth2 / access-request consent flow. It is being re-homed from the legacy auth app and is not yet wired in this build. Until then, use the legacy app-web-auth3 deploy for this specific flow, or sign in directly at /signin."
    />
  );
}

/**
 * Route map. Canonical lowercase/camelCase paths; no `.html` aliases or
 * legacy short paths — operators migrating from app-web-auth3 update their
 * config to point at these canonical paths.
 *
 * Auth flows preserve `pryvServiceInfoUrl` / `returnURL` / `state` /
 * `requestingAppId` through `useLocation().search` on every internal
 * navigation.
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

        {/* CMC hand-offs. /cmc-accept is the canonical path expected by
            @pryv/cmc.requestAccept; /cmc/approve is a shorter alias.
            /cmc-scope-update mirrors /cmc-accept for the scope-update flow. */}
        <Route path="/cmc-accept" element={<CmcApprove />} />
        <Route path="/cmc/approve" element={<CmcApprove />} />
        <Route path="/cmc-scope-update" element={<CmcScopeUpdate />} />

        {/* Access-request + OAuth2 consent UI — re-home pending. */}
        <Route path="/auth" element={<PendingConsentTrack title="Authorize access" />} />
        <Route path="/oauth2-authorize" element={<PendingConsentTrack title="OAuth2 authorize" />} />

        {/* Self-service account management (subject) */}
        <Route path="/account" element={<AccountLayout />}>
          <Route index element={<NavigatePreservingSearch to="/account/profile" />} />
          <Route path="profile" element={<Profile />} />
          <Route path="security" element={<Security />} />
          <Route path="apps" element={<ConnectedApps />} />
          <Route path="data" element={<DataRights />} />
        </Route>

        {/* Landing + 404 */}
        <Route path="/" element={<NavigatePreservingSearch to="/signin" />} />
        <Route path="*" element={<PagePlaceholder title="Not found" description="This page does not exist." />} />
      </Routes>
    </Layout>
  );
}
