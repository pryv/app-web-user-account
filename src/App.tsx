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
import Auth from "./routes/Auth";
import Oauth2Authorize from "./routes/Oauth2Authorize";
import AccountLayout from "./routes/account/AccountLayout";
import Profile from "./routes/account/Profile";
import Security from "./routes/account/Security";
import ConnectedApps from "./routes/account/ConnectedApps";
import DataRights from "./routes/account/DataRights";
import AuditAccess from "./routes/account/AuditAccess";

/** Internal redirect that forwards the current `?…` query through. */
function NavigatePreservingSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
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

        {/* Access-request consent flow (legacy popup-and-poll). */}
        <Route path="/auth" element={<Auth />} />
        {/* OAuth2 (RFC 6749) authorize/consent — the core's `oauth:consentUrl`
            points here; reached via 302 from `GET /oauth2/authorize`. */}
        <Route path="/oauth2-authorize" element={<Oauth2Authorize />} />

        {/* Self-service account management (subject) */}
        <Route path="/account" element={<AccountLayout />}>
          <Route index element={<NavigatePreservingSearch to="/account/profile" />} />
          <Route path="profile" element={<Profile />} />
          <Route path="security" element={<Security />} />
          <Route path="apps" element={<ConnectedApps />} />
          <Route path="data" element={<DataRights />} />
          <Route path="audit-access/:accessId" element={<AuditAccess />} />
        </Route>

        {/* Landing + 404 */}
        <Route path="/" element={<NavigatePreservingSearch to="/signin" />} />
        <Route path="*" element={<PagePlaceholder title="Not found" description="This page does not exist." />} />
      </Routes>
    </Layout>
  );
}
