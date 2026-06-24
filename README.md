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

## License

[BSD-3-Clause](LICENSE)
