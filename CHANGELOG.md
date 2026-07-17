# Changelog

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
