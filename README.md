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

> **Host it on its own origin.** A signed-in session is kept in the browser's
> `localStorage`, which every page of the same origin (scheme + host + port)
> can read, and it contains the user's personal token. Serve the app from a
> dedicated origin (for example `https://account.example.com/`), never from a
> path on a host that also serves other pages or apps. The copy published at
> `https://pryv.github.io/app-web-user-account/` shares its origin with other
> project pages and is a **demo only**: do not use it with a real account.

## Tech stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vite.dev) build/dev server
- [Tailwind CSS](https://tailwindcss.com) for styling
- [React Router](https://reactrouter.com)

## Theming

Brand tokens (palette, typography, radii) are defined as theme variables in
[`src/index.css`](src/index.css). Re-brand by overriding the `--color-*` and
`--font-*` values — no component changes required.

**Branding:** replace [`src/brand.tsx`](src/brand.tsx) and
[`src/brand.css`](src/brand.css). `brand.tsx` sets the product name, the account
noun used in copy ("Register a new … account") and the header `Logo`;
`brand.css` loads the fonts and is imported before the theme tokens, so the
`--font-*` overrides can refer to them. The page title stays in `index.html`.

## Localisation

The UI text lives in `src/locales/en.json` (i18next). The language is chosen,
in order: `?lang=` on the link, the account's language (after sign-in), the
browser's, then English. Brand words are interpolated (`{{product}}`,
`{{account}}`, from `src/brand.tsx`), so a catalog stays brand-neutral.

To add a language:

1. Copy `src/locales/en.json` to `src/locales/<code>.json` and translate the
   values (keep the keys and the `{{...}}` placeholders).
2. In `src/i18n.ts`, import it, add it to `resources`, and add `"<code>"` to
   `SUPPORTED_LOCALES`.
3. Run the tests: a parity test refuses a catalog with missing or extra keys.
   The profile's language selector appears once more than one language ships.

## Extension points

A fork adapts the app by replacing a few files rather than editing many. Each
of them keeps a stable interface; everything else can be merged from upstream.

| File | What to replace it with | Keep stable |
|---|---|---|
| `src/lib/pryvClient.ts` | Your own wrapper of the Pryv client libraries. Every other module imports the client from here, and a test refuses a direct import elsewhere. | The exported names (`Pryv`, `attachSocketIO`, `cmc`, `Delegation`, ...). |
| `src/brand.tsx`, `src/brand.css` | Your product name, account noun, logo and fonts. | `brand`, `Logo`. |
| `src/accountTabs.tsx` + `src/routes.json` | Extra account tabs (`ACCOUNT_TABS`, path relative to `/account`) or top-level pages (`EXTRA_ROUTES`); add each path to `routes.json` (`account` / `static`) for static hosting. A test fails when the two disagree. | The `AccountTab` shape. |
| `src/extensions/ProfileExtensions.tsx` | Extra profile sections, rendered between the account and email cards; receives `{ connection, username }`. Renders nothing by default. | The props. |
| `src/extensions/streamLabels.ts` | `loadStreamLabels(serviceInfoUrl)` returning a `(streamId) => label \| null` resolver, to show your data model's names on consent rows. Default: no labels. | The resolver type. |
| `src/components/consent/ConsentPanel.tsx` | Your consent screen layout; the access-request and OAuth2 pages pass it the app, the rows, the choice state and the actions. | `ConsentPanelProps`. |

The requesting app's name and icon on consent screens come from the operator's
app catalog (`settings.json` `appCatalogUrl`, see Deploy), never from the app
itself.

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
| `pryvServiceInfoUrl` | Which Pryv platform to talk to. Optional when the deployment's `settings.json` names the platform (see [Deploy](#deploy-settingsjson)); when present it wins. |
| `backLabel` | Your app's display name — renders a "← Back to {name}" link in the header. |
| `backUrl` | Where that back link navigates (http/https only; the link always displays the target host). |
| `lang` | UI language for this visit (e.g. `fr`, `fr-CH`), when the build ships it. It wins over the account's language and the browser's, and is not remembered after the visit. |
| `username` | `/signin` only: a sign-in hint (like OIDC `login_hint`) that pre-fills the username field when you already know who the user is. The user can edit it and still enters the password; it grants nothing. |

**Hand-off targets:**

- `/signin?pryvServiceInfoUrl=…&returnURL=<your-url>&state=<csrf>` — sign the
  user in, then redirect to `returnURL` with `state` (reflected unchanged) and
  `pryvApiEndpoint` (the user's API base **without** any token) appended. Use
  this to learn who/where the user is; to obtain a token, run an
  access request (below).
- `/account/profile`, `/account/security`, `/account/apps`, `/account/data`,
  `/change-password`, `/reset-password` — self-service pages; combine with
  `backUrl`/`backLabel` so users find their way back to you. You can link any
  of them directly: a signed-out user is sent to sign in and then back to the
  page you linked, with `backUrl`, `backLabel` and `username` kept (after a
  third-party sign-in, the back link is kept when it returns to the same
  browser tab). (The page
  rides along as `returnTo`, a same-origin account path the app validates; you
  do not need to set it yourself.)
- `/verify-email` — the landing page for a verification email. Don't link it
  directly: point the core's `auth:emailVerificationPageURL` at it and the
  mailed link arrives with `verifyToken` and `username` already set.
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
  trust, not an attacker-supplied one. Set the allowlist of your core origin(s)
  at build time with `VITE_OAUTH_TRUSTED_API_ORIGINS` (comma-separated, e.g.
  `https://core.example.com`), at deploy time in `settings.json` as
  `"trustedApiOrigins": ["https://core.example.com"]`, or both: the page trusts
  the union of the two lists and rejects any other `pryvApi`. Entries are exact
  origins (no wildcards; invalid entries are ignored; in `settings.json`, plain
  `http` is accepted for loopback only), and the list is never
  read from the URL. A production build with both lists empty refuses every
  `pryvApi`. In development, with no list, the page falls back to accepting only a `pryvApi` on the same
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
wrong account. While a session acts for another account (delegation), a
banner under the header says so on every page, based on what the core reports
for the session.

> Note: `backUrl` is a user-initiated *cancel / go-back* affordance. It is
> separate from the authentication-completion redirect (`returnURL` /
> OAuth2 `redirect_uri`), which the auth flow handles on its own. It never
> carries tokens.

## Deploy: `settings.json`

The build ships a `settings.json` next to `index.html`. The app reads it once
when it starts (it never waits more than 4 seconds, and a missing or broken file
just leaves everything unset). Replace it on your deployment to configure the
app without rebuilding. Every key is optional; the shipped file is `{}`.

```json
{
  "serviceInfoUrl": "https://reg.example.com/service/info",
  "trustedApiOrigins": ["https://core.example.com"],
  "legal": {
    "terms": { "en": "https://example.com/terms", "fr": "https://example.com/fr/terms" },
    "privacy": "https://example.com/privacy"
  },
  "appCatalogUrl": "https://assets.example.com/apps/list.json"
}
```

| Key | Effect |
|---|---|
| `serviceInfoUrl` | The platform this deployment serves, used when a link carries no `pryvServiceInfoUrl`. Sessions opened this way are stored against it. |
| `allowedServiceInfoUrls` | Restrict the deployment to these platforms (plus `serviceInfoUrl`). A link naming any other platform, through `pryvServiceInfoUrl` / `serviceInfo`, or an access request whose poll URL is on another platform, is refused before the user can type a password, so a crafted link on your account domain can neither collect passwords nor receive a granted token for someone else's server. `[]` (or a list with no valid entry) means `serviceInfoUrl` only; the key absent means any platform (needed only to serve several platforms from one deployment). An access request's poll URL belongs to a platform when it is served from an origin that platform's service info declares: its `register` or `access` host, its `api` host, or, for an `https://{username}.example.com/` api, any host one label under `example.com` (so the cores of a DNS-based platform need no listing). Cores that service info cannot name (several cores behind a path-style api) go in `trustedApiOrigins`. **Recommended for every single-platform deployment.** |
| `trustedApiOrigins` | Core origins the OAuth2 consent page and CMC result delivery may talk to, added to `VITE_OAUTH_TRUSTED_API_ORIGINS`. With `allowedServiceInfoUrls`, access-request poll URLs on these origins (from either list) are accepted too; on a deployment serving several platforms, links to such a core must name their platform with `pryvServiceInfoUrl` / `serviceInfo`, or sign-in goes to the first allowed platform. |
| `legal.terms`, `legal.privacy` | Links shown at registration, each a URL or a `{ "<lang>": url }` map. When at least one resolves, registering requires ticking "I accept". The Terms fall back to the platform's service-info `terms`. |
| `appCatalogUrl` | The operator's app list, used to name apps on the consent screens (`/auth`, `/oauth2-authorize`) by their id. Apps not listed show their raw id, never a name the app supplies about itself. See the format below. |

Only absolute `http(s)` URLs are accepted. For the same concern the order is:
URL parameter, then `settings.json`, then the build-time setting. The trust list
is the exception: it is never read from the URL.

**App catalog format** (`appCatalogUrl`, schema version 1):

```json
{
  "schemaVersion": 1,
  "apps": [
    {
      "id": "my-app",
      "name": "My App",
      "description": { "en": "Tracks your sleep.", "fr": "Suit votre sommeil." },
      "icon": { "type": "emoji", "value": "🌙" },
      "provider": "Example Ltd"
    }
  ]
}
```

`icon.type` is `emoji`, `url` (absolute http(s)) or `base64` (a PNG, JPEG, GIF
or WebP data URL; no SVG); an invalid icon is ignored and the entry kept. A
newer `schemaVersion` is ignored. The file is fetched once, with no
credentials, within 4 seconds; when unset or unreachable, screens show the raw
app id.

`npm run build:pages` first checks that `node_modules` matches the lockfile and
refuses to build otherwise (run `npm ci`).

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
| Email verification landing | (not in app-web-auth3) | `/verify-email?verifyToken=…&username=…` — set the core's `auth:emailVerificationPageURL` to this URL |

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
