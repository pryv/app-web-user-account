import type { ReactNode } from "react";

/**
 * Address-alias help extension slot, rendered on the OAuth2 consent page
 * under the refusal when the core answers that the address the app was given
 * is one of the account's own address aliases, already used by another app
 * (`reason: "address-alias-held"`). Renders nothing here; a fork replaces
 * this file to point the user at where its integration lists the account's
 * addresses (for example a link to its addresses tab).
 *
 * The slot only adds content: the refusal message and the "Back to the app"
 * button stay as they are.
 */
export default function AddressAliasHelp(): ReactNode {
  return null;
}
