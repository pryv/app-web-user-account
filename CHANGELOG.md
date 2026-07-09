# Changelog

## Unreleased

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
