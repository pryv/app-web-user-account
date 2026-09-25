import type { ReactNode } from "react";
import Profile from "./routes/account/Profile";
import Security from "./routes/account/Security";
import ConnectedApps from "./routes/account/ConnectedApps";
import DataRights from "./routes/account/DataRights";
import DelegationPage from "./routes/account/Delegation";

/** One tab of the account section: nav entry and route. */
export interface AccountTab {
  /** Path relative to /account, e.g. "profile". */
  path: string;
  /**
   * Nav label: a key of `src/locales/*.json` (e.g. "account.nav.profile"),
   * or literal text when the catalog has no such key.
   */
  label: string;
  element: ReactNode;
}

/**
 * Account tabs, in nav order. Adding a tab: add it here and add its path to
 * `account` in `src/routes.json` (a test refuses drift between the two).
 */
export const ACCOUNT_TABS: AccountTab[] = [
  { path: "profile", label: "account.nav.profile", element: <Profile /> },
  { path: "security", label: "account.nav.security", element: <Security /> },
  { path: "apps", label: "account.nav.apps", element: <ConnectedApps /> },
  { path: "delegation", label: "account.nav.delegation", element: <DelegationPage /> },
  { path: "data", label: "account.nav.data", element: <DataRights /> },
];

/**
 * Extra top-level routes (absolute paths, e.g. "/preferences"). Each one also
 * goes in `static` in `src/routes.json`, without the leading slash.
 */
export const EXTRA_ROUTES: Array<{ path: string; element: ReactNode }> = [];
