/**
 * Registration email slot: for deployments that invite people to register
 * and already know their email, so the account is created with it.
 *
 * The register page calls `registerEmailPolicy(search)` once, with the page's
 * query string (`location.search`, for example to read an invitation
 * parameter your links carry), and:
 *
 * - uses `prefill` as the email field's initial value (the user can still
 *   edit it); `null` leaves the field empty;
 * - when `required` is true, marks the field required: a blank email is
 *   refused, and no placeholder address is ever generated for the account.
 *   When false (outside the platform's email verification, which always
 *   requires one), the email stays optional and a blank one is replaced by a
 *   random `@pryv.io` placeholder, as the platform needs an address.
 *
 * The query string comes from the link, so anyone can build one: a `prefill`
 * read from it is a suggestion the user sees and confirms, not a verified
 * address.
 *
 * Changes nothing here; a fork replaces this file.
 */
export interface RegisterEmailPolicy {
  prefill: string | null;
  required: boolean;
}

export function registerEmailPolicy(_search: string): RegisterEmailPolicy {
  return { prefill: null, required: false };
}
