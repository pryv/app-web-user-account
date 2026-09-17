# Changelog

## Unreleased

### Fixed

- **`/cmc-scope-update` reports success only once the change is applied.** The
  page said "The new permission set has been granted" as soon as the answer was
  written, even when the platform changed nothing. It now waits for the
  platform's outcome (requires `@pryv/cmc` 3.14 and a core that applies approved
  scope requests), notes when the collector could not be told yet, hands the
  platform's error id (not English text) back to the calling app, and explains a
  request id that is not on the signed-in account. A request that was already
  answered is shown as such with nothing left to click, and a slow platform
  answer is reported as "still processing" instead of a failure.
- **Accepting an invitation no longer fails when the scope stream does not exist
  yet.** Fixed on the platform side (a core carrying the fix provisions the
  scope when the user accepts); no change to `/cmc-accept`. Fixes #2.

### Added

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
