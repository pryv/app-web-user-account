# Changelog

## Unreleased

### Added

- **Email verification.** The profile page lists every address on the account
  with its verification status (verified, not verified, unconfirmed) and can
  request a verification link or add an address. A new `/verify-email` page
  consumes the mailed link or a pasted code. When the platform requires a
  verified email at sign-up (`features.emailVerification.atRegistration` on the
  service-info), the registration form adds a send-code / verify-code step
  before the account is created; platforms without that flag are unchanged.

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
