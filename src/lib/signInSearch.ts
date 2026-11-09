/**
 * The query string a "Back to sign in" link of the reset page carries: every
 * parameter of the page (`backUrl`, `backLabel`, `pryvServiceInfoUrl`, …) but
 * `resetToken`. Before the reset that token is still valid, and it must not
 * land in the sign-in URL, the browser history, or a hand-off that keeps the
 * query string; after the reset it is spent and has no business there either.
 */
export function signInSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("resetToken");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
