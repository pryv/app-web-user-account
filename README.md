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

## Back-navigation contract

Pages accept `backUrl` + `backLabel` query parameters to render a
"← Back to {label}" link and return the user to the opening app. `backUrl` is
validated against an allowlist of trusted origins to prevent open-redirects.

> Note: `backUrl` is a user-initiated *cancel / go-back* affordance. It is
> separate from the authentication-completion redirect (`returnURL` /
> OAuth2 `redirect_uri`), which the auth flow handles on its own.

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
| Access-request authorization | `/access/access.html`, `/access/auth` | `/auth` — **route stub today**, real component lands with the OAuth2 consent UI work; until then operators that need this flow keep `app-web-auth3` deployed alongside |
| OAuth2 authorize | `/access/oauth2-authorize.html`, `/access/oauth2-authorize` | `/oauth2-authorize` — **same stub** as `/auth` above |
| CMC accept hand-off | `/access/cmc-accept` | `/cmc-accept` (and `/cmc/approve` alias) |
| CMC scope-update hand-off | `/access/cmc-scope-update` | `/cmc-scope-update` |
| Self-service account management | (not in app-web-auth3) | `/account/{profile,security,apps,data}` |

### Migration steps (operator-side)

1. **Deploy `app-web-user-account`** at a URL of your choice (Vite produces a
   static bundle; serve any way you like — gh-pages, S3+CloudFront, nginx).
2. **Point your platform config** at the new paths:
   - `auth.authUrl` → `<your-deploy>/auth` (note: see "What still needs the
     legacy app" below)
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

The **access-request authorization flow** (`/auth`) and the **OAuth2 authorize
endpoint** (`/oauth2-authorize`) are not yet implemented in React in this app —
the routes exist and render a placeholder so callers see an explanation, not a
404. Until the consent UI port lands, operators who need these flows keep
`app-web-auth3` deployed alongside `app-web-user-account` and point their
`auth.authUrl` at the legacy host for those two URLs only. All other flows can
move to this app today.

## License

[BSD-3-Clause](LICENSE)
