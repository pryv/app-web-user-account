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
> path on a host that also serves other pages or apps. The reference copy is
> served on its own origin at `https://account.pryv.me/`; the copy at
> `https://pryv.github.io/app-web-user-account/` shares its origin with other
> project pages and is kept as a fallback demo only.

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

**Light and dark:** the palette follows the `data-theme` attribute on `<html>`.
`light` and `dark` pin it; with no attribute it follows the OS
(`prefers-color-scheme`). The app sets the attribute at start from the
operator's default (`settings.json` `theme.default`: `system`, `light` or
`dark`; `system` when unset) and, unless the operator sets `theme.userChoice`
to `false`, from the user's pick in the header toggle (follow the system,
light, dark). The pick is kept in `localStorage` under `pryv.theme`; on a
shared origin such as `pryv.github.io` that storage is shared with the other
apps served there, hence the `pryv.` prefix. When storage is unavailable the
pick lasts for the page only. To change the dark palette, override the
`--color-*` surface tokens under both `:root[data-theme="dark"]` and the
`prefers-color-scheme: dark` block in [`src/index.css`](src/index.css). There is
no URL parameter for the theme.

**Fonts shipped:** Roboto 400 (body), 500 (labels, buttons) and 700 (`<strong>`),
and Roboto Condensed 500 (headings) and 700 (`<strong>` inside a heading), in the
latin and latin-ext subsets only (Western and Central European languages,
including French, Polish, Czech, Turkish and Romanian). `brand.css` imports the
per-subset fontsource files (`@fontsource/roboto/latin-400.css`, ...);
`src/brand.test.ts` fails if a full `<weight>.css` import, which ships every
script, comes back. If your rebrand uses another weight, import its latin and
latin-ext files the same way.

**Icons:** `lucide-react` icons, `aria-hidden` and always beside a text label,
mark secondary and destructive actions and alert tones, while the primary CTAs of
the auth and consent screens (the consent Accept/Refuse pair included) and tab
navigation stay text-only; the full rule is in
the header of [`src/components/ui.tsx`](src/components/ui.tsx).

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
4. If the language uses a script outside latin and latin-ext (Cyrillic, Greek,
   Vietnamese, ...), add its font subset for every face in `src/brand.css`, for
   example `@import "@fontsource/roboto/cyrillic-400.css";` above the
   `latin-ext-400.css` line (the latin files stay last, so Latin text keeps
   using them), for each weight of both families, and allow that subset
   in the `SUBSET_ENTRY` pattern of `src/brand.test.ts`. Without it the text
   renders in the fallback system font.

## Extension points

A fork adapts the app by replacing a few files rather than editing many. Each
of them keeps a stable interface; everything else can be merged from upstream.

| File | What to replace it with | Keep stable |
|---|---|---|
| `src/lib/pryvClient.ts` | Your own wrapper of the Pryv client libraries. Every other module imports the client from here, and a test refuses a direct import elsewhere. | The exported names (`Pryv`, `attachSocketIO`, `cmc`, `Delegation`, ...). |
| `src/brand.tsx`, `src/brand.css` | Your product name, account noun, logo and fonts. | `brand`, `Logo`. |
| `src/accountTabs.tsx` + `src/routes.json` | Extra account tabs (`ACCOUNT_TABS`, path relative to `/account`) or top-level pages (`EXTRA_ROUTES`); add each path to `routes.json` (`account` / `static`) for static hosting. A test fails when the two disagree. | The `AccountTab` shape. |
| `src/extensions/ProfileExtensions.tsx` | Extra profile sections, rendered between the account and email cards; receives `{ connection, username }`. Renders nothing by default. | The props. |
| `src/extensions/AccessExtras.tsx` | Extra content on the access details page (`/account/audit-access/:accessId`), rendered between the access details card and the audit trail card once the access is loaded; receives `{ connection, access, isSelf }` (`access` is the loaded `AccessDetails`, `isSelf` is true for the session's own access; it is resolved by a separate request, so it can turn from `false` to `true` after the first render). It only adds content: the details card, the revoke button and the audit trail stay as they are. Renders nothing by default. After the user opened the page as a managed account (`?as=`, or Open on the Delegation page), `connection` is that account's delegated session. | The props and the `AccessDetails` type (`src/lib/audit.ts`). |
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
| `backUrl` | Where that back link navigates (http/https only; the link always displays the target host). The link is not shown in a window your app opened by script (`window.opener` set) nor in a frame, where following it would load your app inside that window: open the account pages with a plain link, or `window.open(url, "_blank", "noopener")`, to keep it. On `/auth` in a tab (not a pop-up, not a frame), the page also goes there after the user accepts or cancels, since it cannot close the tab. |
| `lang` | UI language for this visit (e.g. `fr`, `fr-CH`), when the build ships it. It wins over the account's language and the browser's, and is not remembered after the visit. |
| `username` | `/signin` and `/auth`: a sign-in hint (like OIDC `login_hint`) that pre-fills the username field when you already know who the user is. The user can edit it and still enters the password; it grants nothing. On `/auth` (carried on your `authUrl`), when the browser holds a session for another account, the pre-filled form comes first and that session is offered as "Continue as {username} instead"; the hint never signs that session out (when that session's name cannot be looked up, only the form is shown). An email hint is accepted and resolved when the user submits. The hint names the account that signs in: an app that hints a managed account gets its user asked for that account's password, so hint the person who is signing in. |

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
- `/account/delegation?create=1`: account delegation, opened on the
  create-a-managed-account form (scrolled into view, cursor in the username
  field). Link it from an app that sends a carer to create an account for
  someone they look after. It is a self-service page like the ones above:
  a signed-out user signs in first and comes back with `create=1` kept (a
  `#create` fragment also works for a signed-in user, but does not survive
  the sign-in). With `backUrl`/`backLabel`, a successful creation adds
  "Continue to {backLabel}" (with the host shown) under the success notice,
  a link to `backUrl` as given. Removing a delegate who accepted
  cross-account consents for this account first lists those consents (who
  asked, what is shared, when, which delegate approved) with a Keep /
  Withdraw choice for each, nothing chosen in advance: a kept consent becomes
  the owner's own, a withdrawn one ends and its requester is told. A consent
  whose requester never received it (a delivery that failed and awaits its
  retry) is listed as not delivered and is withdrawn; it cannot be kept. Needs a
  core that supports the review (open-pryv.io 2.0.0-rc.31 or later): an older
  core withdraws every consent whatever the choice, and the page says so
  after the removal.
- `/account/audit-access/<accessId>`: one access of the signed-in account (its
  details, Revoke, audit trail), the page the rows of `/account/apps` open. Link
  it when your app shows the user a consent or an app access and wants to send
  them to its page. For an access of an account the user MANAGES (account
  delegation), add `as=<username>`: when the user actively manages that
  account, the page first asks "Open as {username}?" and, on Open, acts for that
  account exactly as Open on the Delegation page does (banner on every page,
  "Back to {user}" to return), then shows the access. The user must click:
  a link never changes which account the pages act for on its own. When the user
  does not actively manage the account named (or it does not exist: the page
  does not tell the two apart), or the managed accounts cannot be listed, the
  page says so and shows the user's own account; naming the account the session
  already is does nothing. `as` is read once and dropped from the address. A
  signed-out user signs in first and comes back with `as` kept, like `create=1`.
- `/verify-email` — the landing page for a verification email. Don't link it
  directly: point the core's `auth:emailVerificationPageURL` at it and the
  mailed link arrives with `verifyToken` and `username` already set.
- `/auth` — the access-request consent flow. Don't link it directly: create an
  access request (lib-js `Pryv.Browser.setupAuth(...)` or
  `POST {register}/access`, optionally passing `authUrl` pointing at this
  app's `/auth` if the platform's `access:trustedAuthUrls` allows it) and open
  the `authUrl` the server returns. Your `authUrl` may carry `backUrl`,
  `backLabel` and `username` in its query (the trusted-URL match ignores the
  query). After the
  user accepts or cancels, a pop-up your app opened closes. A tab it did not
  open (typically a phone, where the sign-in redirects) cannot be closed by the
  page: it goes back to `backUrl` when you gave one, otherwise it shows "This
  request is complete". A pop-up is never sent to `backUrl`. "Create account"
  and "Forgot password?" on `/auth` open in the same window and keep the
  request and the way back, so the user returns to the consent screen after
  creating an account, signed in as that account and without the "Welcome
  back" card (which stays for a session stored before the request).

  **Continue to a consent offer in the same window (`next`).** When your app
  also needs the user's decision on a consent offer (a `@pryv/cmc` invite), put
  the `/cmc-accept` link in `next` on your `authUrl`, URL-encoded as one
  parameter, with the offer page's own query inside it:

  ```
  https://<this-app>/auth?next=%2Fcmc-accept%3FcapabilityUrl%3D…%26scopeStreamId%3D…%26mode%3Dpopup%26returnUrl%3Dhttps%253A%252F%252Fyour-app.example
  ```

  After the user accepts the access request and the outcome is posted, the
  window continues to that page (`/cmc-accept?capabilityUrl=…&scopeStreamId=…&mode=popup&returnUrl=…`,
  without `next`) instead of closing; it reuses the session the user just
  signed in with, shows the offer with its own Approve and Decline, and reports
  its outcome as `/cmc-accept` always does. Two decisions: declining the offer
  leaves the app access in place. The rules:
  - `next` must be exactly `/cmc-accept` or `/cmc-scope-update`, followed only
    by its query; any other path, a URL or `//host` is ignored and the window
    closes as usual. It is page-only: the access request knows nothing of it.
  - Accept only: Cancel and Reject end the flow and never follow `next`; a
    `returnURL` on the request (or a multi-core redirection) keeps precedence;
    in CLI mode `next` is ignored.
  - It survives "Create account", "Forgot password?" and the sign-in, like
    `backUrl`.
  - In a pop-up, pass `mode=popup&returnUrl=<your origin>` inside `next`: after
    the in-window hop the referrer is this app, not yours, so `/cmc-accept`
    pins the result it posts to your opener page to `returnUrl`'s origin (a
    referrer from another origin still comes first). The pop-up keeps its
    `window.opener` across the hop.
  - The offer is decided by the session this app holds: the account that
    signed in, even when the access was granted on an account the user manages
    (`actAs` below), or, when the account pages were acting for a managed
    account, that account's delegated session (which the core refuses until a
    delegate may accept a consent for the account it manages).
  - The core keeps the `/auth` query of your `authUrl` with the pending access
    request and returns it on every poll while the request waits for the
    user, so the capability URL
    in `next` is readable by whoever holds the poll URL for as long as the
    request lives (up to an hour). Harmless for an invite published as an open
    link; for a single-use invite it is a bearer link until the request
    expires.

  **Consent invites inside the access request (`cmcInvites`).** Instead of a
  second page, your app can put the consent invites it needs answered in the
  access request body itself (`POST {register}/access`, needs a core that
  echoes `cmcInvites` on its `201` answer):
  `cmcInvites: [{ capabilityUrl, mandatory?, for?, accessName? }]`, 1 to 8
  entries, `mandatory` `false` by default, `for` `"self"` (default) or
  `"target"` (the account the access is granted for, see `actAs` below),
  `accessName` the name of the grant the accept creates on the accepting
  account (1 to 256 characters; without it, the default name; needs an
  open-pryv.io release newer than 2.0.0-rc.35, an older core refuses an entry
  carrying it). After the user signs
  in, the consent screen shows the app access first, then one block per invite
  (who asks, their consent text, what they ask for) with its own Approve and
  Decline; the app access's Accept becomes "Continue", enabled once every
  invite has a decision (Reject still refuses the whole request). Approving or
  declining an invite only records the choice; on Continue the page, in this
  order:
  - answers every declined invite with a refusal (`@pryv/cmc` `refuseInvite`,
    with the same session its accept would use), as `/cmc-accept`'s Decline
    does, so the requester is told; best-effort: a refusal that cannot be sent
    does not block, and an invite that could not be read or names no scope has
    nothing to answer with;
  - refuses the request when a **mandatory** invite was declined: `REFUSED`
    with `reasonId: "REFUSED_MANDATORY_CONSENT"`, before anything else is
    written (no invite accepted, no access created);
  - accepts every approved invite (mandatory ones first) with `@pryv/cmc`
    `acceptInvite`, on the scope the requester stamped on its offer
    (`originStreamId`, else `:_cmc:apps:<its app id>`), with the entry's
    `accessName` when it has one: `for: "self"` with
    the signed-in person's own session, `for: "target"` with the delegate token
    on the managed account the access is granted for (with no such account,
    with the person's own session, and the outcome says `acceptedFor: "self"`);
  - refuses the request when a mandatory invite cannot be accepted: `REFUSED`
    with `reasonId: "MANDATORY_CONSENT_FAILED"` and the platform's error id in
    `message`, no access created (mandatory invites accepted before it stay
    accepted); a wait that ends before the platform records the outcome
    (`cmc-capability-timeout`) is reported, not refused, since the accept
    usually completes moments later; an optional invite that fails is reported
    and the grant goes on;
  - creates (or keeps) the app access, then posts `ACCEPTED` with `cmcInvites`:
    one outcome per invite, in the request's order,
    `{ acceptEventId, dataGrantAccessId?, acceptedFor? }`, `{ declined: true }`
    or `{ reason }`.

  A declined invite's outcome is `{ declined: true }` whether or not its
  refusal could be sent. The outcomes are a hint, like
  `delegation`: your app (or the requester) learns the truth from the
  requester's inbox (`@pryv/cmc` `waitForAccept`); `mandatory` is enforced by
  this page, not re-checked by the core. An invite whose offer cannot be read,
  or that names no scope, can only be declined. An access the app already holds
  is not handed over before the invites are answered: it is shown, kept as it
  is (its streams named as the request names them), and handed over with the
  outcomes.

  When the request went through "who is this for?", each block says whose
  consent it is, by the same rule its accept follows: "For you (username)" for
  the signed-in account, "For username, whom you look after" for the managed
  account chosen there. An invite whose offer the account it applies to
  already accepted (a live grant on that account carrying the offer's event id
  in `clientData.cmc.offerEventId`) shows as "Already given on {date}", with no
  Approve or Decline: it counts as accepted (it satisfies `mandatory`), nothing
  is written, and its outcome is `{ acceptEventId, dataGrantAccessId }` from
  that grant. A withdrawn grant does not count; if the account's accesses
  cannot be listed, the invite is shown as usual. The capability URLs stay in the
  request, readable by whoever holds the poll URL while it lives, as for
  `next` above.

  **Accounts the user manages (`actAs`).** On a platform running account
  delegation (`features.delegation` in its service info), a signed-in user who
  actively manages other accounts is asked which account the access is for:
  their own, or one they manage. The app steers that choice with `actAs` in
  the access request body (`POST {register}/access`): `"allow"` (the default:
  the user may pick), `"deny"` (the signed-in account only, no choice offered),
  or a username to preselect. When the user does not actively manage the
  account named, the choice (when one is offered) says so and preselects as if
  no account had been named (the account the account pages were acting for,
  else the user's own). A user who manages no other account is offered no
  choice and grants on their own account, unless your request sends `actAs`
  (`"allow"` or a username): the step is then shown even with the user's own
  account as the only choice, with "Create an account for someone you look
  after" below it (the creation form and full-control warning of
  `/account/delegation`, submitted with the user's own session; not offered to
  a session acting for another account). The account created joins the
  choices, selected, and the user presses "Continue for {account}" (nothing
  continues on its own). When `actAs` names an account the user does not
  manage yet, the form opens pre-filled with that username. A request that
  does not send `actAs` keeps the step only for users who manage accounts, so
  apps that never serve managed accounts gain no step. Your app receives an
  ordinary app access on the chosen account; when that is a managed account, the
  `ACCEPTED` answer also carries `delegation` (`isDelegatedAccess`,
  `controlledUsername`, `delegate.username`) for display (the authoritative
  answer is `delegation` in the token's `access-info`). A `username` hint
  names who signs in, not the account the access is for: use `actAs` for that.

  **Only an account the user manages (`actAsManagedOnly`).** For a request
  that only makes sense for someone the user looks after (registering a child,
  say), send `actAsManagedOnly: true` next to `actAs` (`"allow"` or a
  username; the core refuses it without `actAs` or with `"deny"`). The step
  then never offers the signed-in account: it lists the active managed
  accounts only, preselects the account `actAs` names (else the one the
  account pages were acting for), otherwise none, and Continue waits until
  one is chosen. With no managed account yet, "Create an account for someone
  you look after" opens directly (pre-filled with the `actAs` username when
  it names one); the account created is selected. A session acting for a
  managed account keeps it preselected, with no creation offer. When no
  managed account can be used (the platform does not run delegation, its
  info could not be read, the managed accounts could not be listed and none
  can be created, or a session
  acting for another account manages none), the page says why and offers
  Cancel only, which answers `REFUSED` with
  `reasonId: "MANAGED_ACCOUNT_UNAVAILABLE"` and a `message` naming the cause.
  `for: "target"` invites are then always answered on the managed account
  chosen, never with `acceptedFor: "self"`. The page reads the field from the
  core's echo on the poll state: it needs an open-pryv.io release newer than
  2.0.0-rc.35. An older core drops the field and does not echo it, so the
  page behaves per `actAs` (the user's own account included with `"allow"`);
  so does an older version of this page on a newer core. Check the field on
  the core's `201` answer to know whether it was understood.
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

> Note: `backUrl` is a *cancel / go-back* affordance. It is separate from the
> authentication-completion redirect (`returnURL` / OAuth2 `redirect_uri`),
> which the auth flow handles on its own, and it never carries tokens. The
> user follows it by clicking the back link, except on `/auth` in a tab that
> cannot be closed, where the page follows it after the decision (nothing is
> appended to it; the app polls its request as usual).

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
  "appCatalogUrl": "https://assets.example.com/apps/list.json",
  "theme": { "default": "system", "userChoice": true }
}
```

| Key | Effect |
|---|---|
| `serviceInfoUrl` | The platform this deployment serves, used when a link carries no `pryvServiceInfoUrl`. Sessions opened this way are stored against it. |
| `allowedServiceInfoUrls` | Restrict the deployment to these platforms (plus `serviceInfoUrl`). A link naming any other platform, through `pryvServiceInfoUrl` / `serviceInfo`, or an access request whose poll URL is on another platform, is refused before the user can type a password, so a crafted link on your account domain can neither collect passwords nor receive a granted token for someone else's server. `[]` (or a list with no valid entry) means `serviceInfoUrl` only; the key absent means any platform (needed only to serve several platforms from one deployment). An access request's poll URL belongs to a platform when it is served from an origin that platform's service info declares: its `register` or `access` host, its `api` host, or, for an `https://{username}.example.com/` api, any host one label under `example.com` (so the cores of a DNS-based platform need no listing). Cores that service info cannot name (several cores behind a path-style api) go in `trustedApiOrigins`. **Recommended for every single-platform deployment.** |
| `trustedApiOrigins` | Core origins the OAuth2 consent page and CMC result delivery may talk to, added to `VITE_OAUTH_TRUSTED_API_ORIGINS`. With `allowedServiceInfoUrls`, access-request poll URLs on these origins (from either list) are accepted too; on a deployment serving several platforms, links to such a core must name their platform with `pryvServiceInfoUrl` / `serviceInfo`, or sign-in goes to the first allowed platform. |
| `legal.terms`, `legal.privacy` | Links shown at registration, each a URL or a `{ "<lang>": url }` map. When at least one resolves, registering requires ticking "I accept". The Terms fall back to the platform's service-info `terms`. |
| `appCatalogUrl` | The operator's app list, used to name apps on the consent screens (`/auth`, `/oauth2-authorize`) by their id. Apps not listed show their raw id, never a name the app supplies about itself. See the format below. |
| `theme.default`, `theme.userChoice` | The light / dark default: `"system"` (follow the OS, the default), `"light"` or `"dark"`. `userChoice` (default `true`) shows the theme toggle in the header and lets a user's stored pick override the default; `false` hides the toggle and always applies the default. Invalid values are ignored. See [Theming](#theming). |

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

Two production builds exist:

- `npm run build:root` builds for the root path of a dedicated origin (for
  example `https://account.example.com/`), with one page per route
  (`auth.html`, `register.html`, ...) so entry points answer 200 on servers with
  GitHub Pages semantics, and `404.html` as the fallback for dynamic routes.
  This is what an open-pryv.io platform serves as a hosted site
  (`hostedSites: { account: { static: <folder> } }`), and what a release ships
  as `app-web-user-account-<version>-root.tar.gz`, created with
  `tar -czf app-web-user-account-<version>-root.tar.gz -C dist .` and attached
  with `gh release upload v<version> app-web-user-account-<version>-root.tar.gz`.
- `npm run build:pages` builds the GitHub Pages copy served under
  `/app-web-user-account/` (adds `404.html` and `.nojekyll`).

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
   **Refuse framing on every page:** send `Content-Security-Policy:
   frame-ancestors 'none'` and `X-Frame-Options: DENY` (nginx:
   `add_header Content-Security-Policy "frame-ancestors 'none'" always;` and
   `add_header X-Frame-Options "DENY" always;`; an `add_header` in a
   `location` drops the server-level ones such as HSTS, so repeat those
   there). The consent pages (`/auth`, `/oauth2-authorize`, `/cmc-accept`,
   `/cmc-scope-update`) must not be framable by another site,
   or it can hide them under a decoy and trick a click on Accept
   (clickjacking); a `<meta>` tag cannot set `frame-ancestors`. open-pryv.io's
   hosted sites (2.0.0-rc.29 and later) send both headers for you. A host that
   cannot send headers (GitHub Pages) should not be listed in your platform's
   `access:trustedAuthUrls`.
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
