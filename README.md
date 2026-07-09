# app-web-user-account

Web app for Pryv **authentication** and **self-service account management**.

It covers the user-facing flows around a Pryv account:

- **Authentication** — sign-in / authorize, registration, password reset & change.
- **MFA challenge** — a multi-factor challenge screen, usable both inside the app
  and launched standalone (e.g. from a CLI that needs the user to complete MFA).
- **Account management** (signed-in subject) — profile & emails, security (MFA,
  active sessions), connected apps (review scopes, revoke access), and data
  rights (export, account deletion).
- **Cross-account approval** — a page to review and approve a request coming from
  an app that does not hold a personal token.

This is a **reference implementation**: it is themeable and intended to be
forked, re-branded, and self-hosted by operators.

## Tech stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vite.dev) build/dev server
- [Tailwind CSS](https://tailwindcss.com) for styling
- [React Router](https://reactrouter.com)

## Theming

Brand tokens (palette, typography, radii) are defined as theme variables in
[`src/index.css`](src/index.css). Re-brand by overriding the `--color-*` and
`--font-*` values — no component changes required.

## Develop

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Integrating from your app (third-party hooks)

Any app can hand its users over to this account app and get them back. A
runnable sample lives in [`examples/third-party-app/`](examples/third-party-app/)
— a single static HTML page you can copy from.

Every route accepts these query parameters:

| Param | Meaning |
|---|---|
| `pryvServiceInfoUrl` | Which Pryv platform to talk to (required on entry links). |
| `backLabel` | Your app's display name — renders a "← Back to {name}" link in the header. |
| `backUrl` | Where that back link navigates (http/https only; the link always displays the target host). |

**Hand-off targets:**

- `/signin?pryvServiceInfoUrl=…&returnURL=<your-url>&state=<csrf>` — sign the
  user in, then redirect to `returnURL` with `state` (reflected unchanged) and
  `pryvApiEndpoint` (the user's API base **without** any token) appended. Use
  this to learn who/where the user is; to obtain a token, run an
  access request (below).
- `/account/profile`, `/account/security`, `/account/apps`, `/account/data`,
  `/change-password`, `/reset-password` — self-service pages; combine with
  `backUrl`/`backLabel` so users find their way back to you.
- `/auth` — the access-request consent flow. Don't link it directly: create an
  access request (lib-js `Pryv.Browser.setupAuth(...)` or
  `POST {register}/access`, optionally passing `authUrl` pointing at this
  app's `/auth` if the platform's `access:trustedAuthUrls` allows it) and open
  the `authUrl` the server returns.
- `/oauth2-authorize` — the OAuth2 (RFC 6749) consent page. Don't link it
  directly either: your app starts at the core's `GET /oauth2/authorize`
  (with `client_id`, `redirect_uri`, PKCE challenge, `scope`, `state`), and
  the core 302-redirects the browser here with `state` (an HMAC-signed
  payload the page decodes for display only — the server re-verifies it on
  accept/refuse) and `pryvApi` (the API endpoint the page calls back). The
  user signs in (username or email, MFA-aware), reviews the requested scopes
  (unticking a scope grants only the remaining subset), and Accept/Reject
  sends the browser to your `redirect_uri` with the authorization code or
  `error=access_denied`. The core must be configured with `oauth:consentUrl`
  pointing at this route (e.g. `https://<your-deploy>/oauth2-authorize`).

  **Security — trusted `pryvApi`:** the page sends the user's password (sign-in)
  and personal token (Accept) to the `pryvApi` origin, so it must be a core you
  trust, not an attacker-supplied one. Set `VITE_OAUTH_TRUSTED_API_ORIGINS`
  (comma-separated origins, e.g. `https://core.example.com`) at build time to an
  allowlist of your core origin(s); the page rejects any other `pryvApi`. If you
  don't set it, the page falls back to accepting only a `pryvApi` on the same
  registrable domain as this deploy (so `https://attacker.com` is refused, but a
  multi-label public suffix such as `*.co.uk` or a cross-domain core needs the
  explicit allowlist). Non-https `pryvApi` is always refused (loopback aside).

**Data export (Art. 15/20):** the Data-rights tab's **Start export** hands off
to [`pryv-account-backup-webapp`](https://github.com/pryv/pryv-account-backup-webapp)
— the subject signs in there and downloads a portable ZIP series. No token is
passed in the URL (the backup app authenticates the subject itself). The
hand-off target defaults to
`https://pryv.github.io/pryv-account-backup-webapp/`; operators hosting their
own rebranded backup app point at it with the `VITE_BACKUP_WEBAPP_URL`
build-time env var.

**Sessions:** a successful sign-in is persisted in the browser
(`localStorage`), so a returning user gets a "Continue as {username}" step
instead of retyping credentials — with a "Not me — use another account"
escape so a shared browser can't silently act (or grant access) under the
wrong account.

> Note: `backUrl` is a user-initiated *cancel / go-back* affordance. It is
> separate from the authentication-completion redirect (`returnURL` /
> OAuth2 `redirect_uri`), which the auth flow handles on its own. It never
> carries tokens.

## Replacing `app-web-auth3` on an operator platform

This app is the planned successor to the legacy `app-web-auth3`. The two
**do not share URLs** — every operator that switches updates their platform
configuration to point at the new canonical paths. There is no `.html`-suffix
compatibility layer and no `/access/` base-path requirement; deploy where you
like, configure your platform to point there.

| What | Legacy `app-web-auth3` path | New `app-web-user-account` path |
|---|---|---|
| Sign-in | `/access/signinhub.html`, `/access/signin` | `/signin` |
| Register | `/access/register.html`, `/access/register` | `/register` |
| Password reset (request + token modes) | `/access/reset-password.html`, `/access/reset` | `/reset-password` (request) and `/reset-password?resetToken=…` (set new) |
| Change password (signed-in) | `/access/change-password.html`, `/access/change-password` | `/change-password` |
| MFA challenge | (handled inline; CLI flow is new) | `/mfa-challenge` |
| Access-request authorization | `/access/access.html`, `/access/auth` | `/auth` |
| OAuth2 authorize | `/access/oauth2-authorize.html`, `/access/oauth2-authorize` | `/oauth2-authorize` — set the core's `oauth:consentUrl` to this URL |
| CMC accept hand-off | `/access/cmc-accept` | `/cmc-accept` (and `/cmc/approve` alias) |
| CMC scope-update hand-off | `/access/cmc-scope-update` | `/cmc-scope-update` |
| Self-service account management | (not in app-web-auth3) | `/account/{profile,security,apps,data}` |

### Migration steps (operator-side)

1. **Deploy `app-web-user-account`** at a URL of your choice (Vite produces a
   static bundle; serve any way you like — gh-pages, S3+CloudFront, nginx).
2. **Point your platform config** at the new paths:
   - `auth.authUrl` → `<your-deploy>/auth`
   - `oauth.consentUrl` → `<your-deploy>/oauth2-authorize` (if OAuth2 is
     enabled on your platform)
   - `service.access.url` / equivalent → `<your-deploy>/signin`
   - any custom email templates that link into the legacy `.html` paths →
     update the links to the new canonical paths
3. **Rebrand** by overriding `--color-*` and `--font-*` in
   [`src/index.css`](src/index.css) or by injecting your own CSS that overrides
   the same variables. The brand-token contract is documented under
   [Theming](#theming).
4. **Sanity-check** with the bundled E2E tests against your deploy:
   `npm install && npm run e2e`.

### What still needs the legacy `app-web-auth3`

Nothing — every flow `app-web-auth3` served has a counterpart here, including
the access-request authorization flow (`/auth`) and the OAuth2 consent page
(`/oauth2-authorize`). Operators can retire their `app-web-auth3` deployment
once their platform configuration points at this app.

## License

[BSD-3-Clause](LICENSE)
