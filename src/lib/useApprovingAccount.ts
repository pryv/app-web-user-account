import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "./useSession";
import { storedServiceInfoUrl } from "./sessionStore";
import { signInLinkFor } from "./handoffReturn";
import { loggableError } from "./apiError";
import { isValidUsername } from "./username";

/** Longest wait for the signed-in account's name before asking to sign in again (as `/auth`). */
export const ACCOUNT_LOOKUP_WAIT_MS = 4000;

/** The account the session acts on, as the page knows it. */
export type ApprovingAccount = { status: "loading" } | { status: "known"; username: string } | { status: "unknown" };

/**
 * The account the calling app expects to answer (`username=`, lowercased), or
 * null. Only a value that can be a username counts: the page shows it, so a
 * crafted link cannot put arbitrary text there. An email (or any other value)
 * is not compared; it only pre-fills the sign-in form, like any `username` hint.
 */
export function expectedUsernameOf(search: string): string | null {
  // Lowered first: usernames are lowercase-only, and the rule rejects capitals.
  const hint = new URLSearchParams(search).get("username")?.trim().toLowerCase() ?? "";
  return isValidUsername(hint) ? hint : null;
}

export interface ApprovingAccountView {
  account: ApprovingAccount;
  /** The signed-in account's name, once known. */
  signedInAs: string | null;
  /** The account the calling app expects (`username=`), when it names one. */
  expectedUsername: string | null;
  /** The signed-in account is not the one the calling app expects. */
  wrongAccount: boolean;
  /** The page may answer with the session: its account is known and is the expected one. */
  mayAnswer: boolean;
  /** The actions give way to "Switch account": the account could not be confirmed, or is not the expected one. */
  blocked: boolean;
  /** Sign out, sign in (as someone else), and come back to this same request. */
  switchAccount: () => void;
}

/**
 * Who answers a cross-account request on a page that reuses the stored
 * session (`/cmc-accept`, `/cmc-scope-update`): whichever account this browser
 * holds, which is not necessarily the person the request was meant for.
 * `route` is the page's own path, returned to after switching account.
 */
export function useApprovingAccount(route: string, logLabel: string): ApprovingAccountView {
  const { connection, setConnection } = useSession();
  const { search } = useLocation();
  const navigate = useNavigate();
  const expectedUsername = expectedUsernameOf(search);
  const accountEndpoint = connection?.apiEndpoint ?? null;

  const [account, setAccount] = useState<ApprovingAccount>({ status: "loading" });
  useEffect(() => {
    setAccount({ status: "loading" });
    if (!connection) return;
    let cancelled = false;
    // The lookup is a network call: a stalled one must not leave the actions
    // disabled with no way out. Past the wait, ask to sign in again; a name
    // arriving later is ignored (the page does not change under the user).
    const giveUp = setTimeout(() => {
      console.warn(`${logLabel}: the signed-in account could not be read in time`);
      cancelled = true;
      setAccount({ status: "unknown" });
    }, ACCOUNT_LOOKUP_WAIT_MS);
    connection
      .username()
      .then((username) => {
        if (!cancelled) setAccount({ status: "known", username });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(`${logLabel}: could not read the signed-in account:`, loggableError(err));
        setAccount({ status: "unknown" });
      })
      .finally(() => clearTimeout(giveUp));
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
    // The session's account (its endpoint) decides; the object identity does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountEndpoint]);

  const signedInAs = account.status === "known" ? account.username : null;
  const wrongAccount = signedInAs != null && expectedUsername != null && expectedUsername !== signedInAs.toLowerCase();

  function switchAccount() {
    const query = new URLSearchParams(search);
    // Signing out forgets the session's platform: keep it on the way back.
    const platform = storedServiceInfoUrl();
    if (!query.has("pryvServiceInfoUrl") && platform) query.set("pryvServiceInfoUrl", platform);
    // Navigate first, then drop the session: /signin then opens on its form.
    navigate(signInLinkFor(route, "?" + query.toString()));
    setConnection(null);
  }

  return {
    account,
    signedInAs,
    expectedUsername,
    wrongAccount,
    mayAnswer: signedInAs != null && !wrongAccount,
    blocked: account.status === "unknown" || wrongAccount,
    switchAccount,
  };
}
