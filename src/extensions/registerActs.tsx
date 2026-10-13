import type { ReactNode } from "react";
import type { PryvConnection } from "../lib/session";
import type { FlatHosting } from "../lib/service";

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
 * `input.hosting` is the hosting the user has chosen (the platform's
 * `/reg/hostings` entry), or `null` while none is: with several hostings none
 * is pre-selected. The hosting decides where the account's data is stored, so
 * an operator can describe that location here and record it with the acts.
 * `input` is a new object on every render: depend on `input.hosting` (stable
 * between renders), never on `input` itself.
 *
 * Collects nothing here; a fork replaces this file to add its acts. A
 * replacement must accept the argument (it may ignore it): the register page
 * passes it, and a hook declared with no parameter fails the type check.
 */
export interface RegisterActs {
  element: ReactNode | null;
  ready: boolean;
  onRegistered?: (connection: PryvConnection) => Promise<void>;
}

export interface RegisterActsInput {
  hosting: FlatHosting | null;
}

export function useRegisterActs(_input: RegisterActsInput): RegisterActs {
  return { element: null, ready: true };
}
