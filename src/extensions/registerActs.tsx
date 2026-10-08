import type { ReactNode } from "react";
import type { PryvConnection } from "../lib/session";

/**
 * Registration acts slot: what an operator collects at account creation on top
 * of the Terms acceptance (an explicit consent, a residence declaration, ...).
 * The register page calls this hook once per render and:
 *
 * - renders `element` between the form fields and the Create button;
 * - keeps Create disabled until `ready` is true;
 * - after the account is created and signed in, awaits
 *   `onRegistered(connection)` (a personal-token connection to the new
 *   account) before moving on, so the acts can be written into the account.
 *   A failure there is logged and does not fail the registration: the
 *   account exists, and the sign-in gate (`signInGate.ts`) can ask again.
 *   When the automatic sign-in after registration fails, it is not called.
 *
 * Collects nothing here; a fork replaces this file to add its acts.
 */
export interface RegisterActs {
  element: ReactNode | null;
  ready: boolean;
  onRegistered?: (connection: PryvConnection) => Promise<void>;
}

export function useRegisterActs(): RegisterActs {
  return { element: null, ready: true };
}
