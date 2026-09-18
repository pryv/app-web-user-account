# Changelog

## Unreleased

## 0.2.1 — 2026-09-18

### Changed

- Built with the latest Pryv client libraries: `pryv`, `@pryv/delegation` and
  `@pryv/socket.io` 3.13.0, `@pryv/cmc` 3.16.1 (were 3.11.0, 3.11.0, 3.8.0 and
  3.14.0).

### Fixed

- **A CMC request answered while acting for a controlled account now says why it
  was refused.** open-pryv.io 2.0.0-rc.23 refuses approving a CMC request or
  answering a scope update with a token obtained through account delegation
  (`delegation-grant-requires-owner`): only the account owner can do it. The
  `/cmc-accept` and `/cmc-scope-update` pages now show that in plain words instead
  of the raw API error, and hand `delegation-grant-requires-owner` back to the
  calling app as the failure reason.

## 0.2.0 — 2026-09-18

Granting an app access for a controlled account needs a core that advertises
`features.delegation` in its service info, and the credential hand-off on `/auth`
needs a core that supports `credentialHandoff` (open-pryv.io 2.0.0-rc.23 or later).
On an older core the first is not offered and the second falls back to the inline
delivery.

### Added

- **Credential hand-off: the `/auth` page can deliver an app's token through a
  one-time shared secret instead of the authorization poll.** When a request asks
  for it (`credentialHandoff`), and it is not a consent-form or delegated grant, the
  page creates the one-time secret itself with the personal token and posts only the
  key, so the app's token never reaches the core that answered the request. Any
  failure to create the secret falls back to the inline delivery, which the server
  converts or delivers as before.
- **Grant an app access for an account you control.** On a platform that runs
  account delegation, after signing in the `/auth` page asks who the access is for:
  the signed-in account or one of the accounts it controls (active delegations
  only). For a controlled account the page obtains a delegate token for that
  account, keeps it in memory only (never stored, never made the session), creates
  the app access there and tells the app it was granted through the delegation. An
  app can preselect an account or turn the question off with its auth request's
  `actAs` (`"deny"`). Requires a core whose service info advertises
  `features.delegation` and that stamps the accesses granted through a delegation;
  on an older core the question is simply not asked.
- **"Back to <your account>" after opening a controlled account.** Opening an
  account from Delegation keeps your own session; a banner shows who you are acting
  as and returns you to your account. Signing out ends both.
- **Granular consent on the app authorization page.** When an app annotates
  the permissions it asks for, `/auth` now behaves like the OAuth2 consent
  screen instead of presenting one all-or-nothing list. Entries the app marked
  as required stay locked with a "(required by this app)" hint; optional
  entries can be unticked; entries the app marked as opt-in open **unticked**,
  so the user has to choose them deliberately. Only the ticked subset is
  granted, and the annotations never travel on the created access.

  Requests without those annotations are unchanged: the whole list renders
  locked, exactly as before.

  If the server refuses the grant, the page says why in the user's terms
  (required permissions missing, all-or-nothing, nothing granted) and removes
  the access it had just created, rather than leaving one the app will never
  receive. A server that could not verify the grant at all is treated
  differently: the page retries once, and only then gives up with a "could not
  be verified, try again" message, because an unverifiable grant says nothing
  about whether the access was good.

- **Email verification.** The profile page lists every address on the account
  with its verification status (verified, not verified, unconfirmed) and can
  request a verification link or add an address. A new `/verify-email` page
  consumes the mailed link or a pasted code. When the platform requires a
  verified email at sign-up (`features.emailVerification.atRegistration` on the
  service-info), the registration form adds a send-code / verify-code step
  before the account is created; platforms without that flag are unchanged.
  The `/verify-email` page drops the verification token from the address bar as
  soon as it has read it, so the token does not linger in browser history or in
  the Referer of anything opened from that page.

- **Third-party sign-in (SSO) — beta.** When the core exposes providers
  (`GET /auth/sso/providers`), the sign-in page shows "Sign in with <provider>"
  buttons. A new `/sso-signin` landing route receives the core's callback on the
  URL fragment, clears it before any network call, and redeems the one-time
  shared-secret hand-off for the session (the session token never appears in a
  URL); an MFA-active account is routed through the existing `/mfa-challenge`
  continuation, and refusals show a coarse message. Requires `pryvServiceInfoUrl`
  on the landing URL; inert unless the core has SSO configured.

### Fixed

- **"Continue as" in the auth popup no longer signs you out on a network or server
  error.** Any failure while continuing with the stored session (a dropped
  connection, a 5xx) dropped the session, signing the account pages out too. The
  session is now dropped only when the platform rejects its token (HTTP 401/403,
  `invalid-access-token`, `forbidden`); otherwise the popup says "Could not reach
  the server, please try again." and "Continue as" stays usable.
- **A direct link to an access's details (`/account/audit-access/<id>`) loads the
  page** on the local static server (it answered "Not Found": a route with an id
  cannot be listed in the static fallback, which now also writes `404.html`, as the
  GitHub Pages build already did). The "Details" links on Connected apps, the "Back
  to connected apps" and delegation links on the details page, and the page shown
  after revoking keep the current query (`pryvServiceInfoUrl`), so the platform
  choice survives the navigation.
- **Connected apps no longer offers to revoke the accesses that run an account
  delegation.** On an account in a delegation, `/account/apps` listed the control
  access and the delegate's session (and any invitation or notification access)
  among the apps, and revoking them failed (the platform refuses it). They are now
  listed apart under "Managed by account delegation" with a link to
  `/account/delegation`, where the delegation is ended, and their details page shows
  no Revoke. Apps granted through a delegation stay listed as ordinary, revocable
  apps.
- **The auth popup no longer grants as a controlled account the account pages are
  acting for.** It used to offer "Continue as <that account>", granting with the
  delegate's session, ignoring an app's `actAs: 'deny'` or named account, and
  posting no `delegation` hint (the app showed the account as the user's own). It
  now continues as the account acting and offers the "who is this for?" choice with
  the controlled account preselected (an account the app names comes first). An
  access carrying the platform's lineage marker is always described to the app as
  delegated, including a reused one.
- **The confirmation dialog no longer closes on a text-selection drag** that starts
  inside it and ends outside; only a click that starts and ends outside closes it.
- **`/auth` says why the account an app asked for is not preselected** when the
  signed-in user cannot act for it ("… is not an account you can act for; choose
  below"), instead of silently falling back to the signed-in account.
- **Reloading the auth popup after it finished** says the request is complete
  instead of reporting an unknown request, once the server has forgotten it.
- **Confirmations use an in-app dialog instead of the browser's `confirm()`**
  (revoking an access, disabling multi-factor authentication): it follows the app's
  look, closes on Escape or a click outside, and no longer blocks the page.
- **A direct link to `/account/delegation` loads the page** on static hosts (it
  answered "Not Found": the route was missing from the static fallback list).
- **`/cmc-scope-update` reports success only once the change is applied.** The
  page said "The new permission set has been granted" as soon as the answer was
  written, even when the platform changed nothing. It now waits for the
  platform's outcome (requires `@pryv/cmc` 3.14 and a core that applies approved
  scope requests), notes when the collector could not be told yet, hands the
  platform's error id (not English text) back to the calling app, and explains a
  request id that is not on the signed-in account. A request that was already
  answered is shown as such with nothing left to click, and a slow platform
  answer is reported as "still processing" instead of a failure.
- **Signing in from `/cmc-accept` or `/cmc-scope-update` returns to that page.** It
  used to land on the account profile, so the user had to open the link again.
  The page to return to is matched exactly against those two routes (never a
  URL), and an auth-flow `returnURL` keeps precedence. Also after an MFA step,
  and after creating an account from the sign-in page's "Create account" link.
- **Accepting an invitation no longer fails when the scope stream does not exist
  yet.** Fixed on the platform side (a core carrying the fix provisions the
  scope when the user accepts); no change to `/cmc-accept`. Fixes #2.

## 0.1.0 — 2026-07-17

### Security

- Legacy auth-completion flow no longer navigates to an unvalidated
  query-supplied `returnURL` scheme. `buildCompletionUrl` (sign-in / register /
  MFA completion) and `closeOrRedirect` (access-request flow, incl. the
  `REDIRECTED` multi-core handoff `redirectUrl`) now reject any non-`http(s)`
  target, closing an open-redirect and a `javascript:`/`data:`-scheme XSS that
  would run in the auth origin. Extends the `safeRedirect` guard that already
  covered the consent / OAuth2 / CMC surfaces to these legacy paths.

### Added

- `/oauth2-authorize` — the OAuth2 (RFC 6749) consent page, replacing the
  placeholder route. Reached via 302 from the core's `GET /oauth2/authorize`
  (`oauth:consentUrl` must point at this route). Signs the user in (username
  or email, MFA-aware), renders the consent offer's granular permission set
  (per-stream levels and feature permissions such as `selfRevoke`, plus the
  offer's title/description/consent texts) as individually untick-to-downgrade
  entries, and completes with the core's `/oauth2/authorize/accept`
  (`grantedPermissions` = the kept subset) / `/oauth2/authorize/refuse`
  round-trip. Ported from the reference implementation on the deprecated
  `app-web-auth3`, with two additions: MFA-gated sign-ins and email→username
  resolution.
