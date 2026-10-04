# Changelog

## 0.12.0 - 2026-10-04

### Added

- **Extension slot on the access details page**
  ([#12](https://github.com/pryv/app-web-user-account/issues/12)):
  `src/extensions/AccessExtras.tsx`, rendered on
  `/account/audit-access/:accessId` between the access details card and the
  audit trail card once the access is loaded, with
  `{ connection, access, isSelf }`. Renders nothing upstream; a fork replaces
  it to show what its integration knows about an access (see "Extension
  points" in the README). The `AccessDetails` type moves to `src/lib/audit.ts`
  so the slot can import it.

### Changed

- Removing a delegate with a keep list now goes through `@pryv/delegation`'s
  `detachDelegate(username, { keepAccessIds })` (3.15.0) instead of a raw API
  call; `pryv` and `@pryv/delegation` move to `^3.15.0`. Same request, same
  behaviour.

## 0.11.0 - 2026-10-01

### Added

- **`/auth`: consent invites inside the access request**
  ([#11](https://github.com/pryv/app-web-user-account/issues/11)). An access
  request carrying `cmcInvites` (`[{ capabilityUrl, mandatory?, for? }]`, read
  from the poll state of a core that supports them) shows, after the app
  access, one block per invite with its own Approve and Decline; the page's
  Accept becomes "Continue", enabled once every invite is decided. Continue
  decides, accepts, grants, in that order: each declined invite is answered
  with a refusal (best-effort, as on `/cmc-accept`), so its requester is told;
  a declined mandatory invite refuses the request (`REFUSED_MANDATORY_CONSENT`)
  before anything else is written; the
  approved invites are accepted (mandatory first) on the scope the requester
  stamped on its offer, `for: "self"` with the person's own session and
  `for: "target"` with the delegate token on the managed account the access is
  for (or as self, reported `acceptedFor: "self"`, when there is none); a
  mandatory accept that fails refuses the request (`MANDATORY_CONSENT_FAILED`)
  without a grant (a wait that times out is reported, not refused), an optional
  one is reported and the grant proceeds; then the
  app access is created and `ACCEPTED` carries one outcome per invite
  (`cmcInvites`), a hint for the requester. An access the app already holds
  waits for the invites instead of being handed over at once. A request without
  `cmcInvites` behaves exactly as before.

### Changed

- The `/cmc-accept` offer (requester, consent text, permissions, Approve and
  Decline) is now the shared `CmcOfferBlock` component, also used by `/auth`;
  `/cmc-accept` behaves as before.

## 0.10.0 - 2026-10-01

### Added

- **Removing a delegate: review the consents they gave**
  ([#10](https://github.com/pryv/app-web-user-account/issues/10)). On
  `/account/delegation`, removing a delegate who accepted cross-account consent
  requests for this account opens a review of those consents first: who asked,
  what is shared, when it was given and which delegate approved it, each with
  Keep or Withdraw and nothing chosen in advance; "Remove delegate" stays
  disabled until every consent has a decision. A consent whose requester never
  received it (a delivery that failed and awaits its retry) is listed as not
  delivered and is withdrawn; it cannot be kept. The removal then keeps the
  chosen consents (they become the owner's own) and withdraws the others (their
  requesters are told). A delegate who gave no consent is removed as before. If
  the consents cannot be listed, nothing is removed. Needs open-pryv.io
  2.0.0-rc.31 or later for a keep; until `@pryv/delegation` 3.15.0 passes the
  keep list, the page sends it on the session's connection.

## 0.9.0 - 2026-10-01

### Added

- **`/auth` continues to a consent offer in the same window**
  ([#8](https://github.com/pryv/app-web-user-account/issues/8)). An `authUrl`
  carrying a page-only `next=/cmc-accept?…` (or `/cmc-scope-update?…`, exact
  routes only, the offer page's own query inside `next`) continues to that page
  once the access is granted and the outcome posted, instead of closing: one
  window, one sign-in, two decisions. Accept only (Cancel and Reject never
  follow `next`), only without a `returnURL` (which keeps precedence) and not
  in CLI mode. `next` survives "Create account", "Forgot password?" and the
  sign-in, like `backUrl`. The README notes that the core keeps the `authUrl`
  query, so the capability URL, with the pending request.
- **`/auth`: create the managed account from the "who is this for?" step**
  ([#9](https://github.com/pryv/app-web-user-account/issues/9)). When the access
  request sends `actAs` (`"allow"` or a username) on a platform running
  account delegation, the step is shown even when the user manages no account
  yet, with "Create an account for someone you look after" below the choices:
  the same form and full-control warning as `/account/delegation`, submitted
  with the user's own session (never offered to a session acting for another
  account). The new account joins the choices, selected; the user then presses
  "Continue for {account}". An `actAs` naming an account the user does not
  manage yet opens the form pre-filled with that username. Requests without
  `actAs` are unchanged.

### Changed

- **`/cmc-accept` and `/cmc-scope-update` pin a pop-up's result to `returnUrl`
  when the referrer is this app.** After an in-window hop (from `/auth`) the
  referrer is the account app itself, and the result posted to the opener was
  pinned to it, so the app never received it. A referrer on the page's own
  origin now counts as absent: the pin is `returnUrl`'s origin (a referrer from
  another origin still comes first). Pass `mode=popup&returnUrl=<your origin>`.

## 0.8.1 - 2026-09-30

### Fixed

- **No "Back to {app}" link in a pop-up.** The header link to `backUrl` also
  rendered inside the sign-in pop-up an app opens on `/auth` (and on
  `/register` or `/reset-password` reached from it), and a click loaded the app
  inside the pop-up. The link (and "Continue to {app}" after a managed-account
  creation) is no longer shown in a window an app opened by
  script (`window.opener` set) or in a frame; a tab reached by a link or a
  redirect keeps it. To keep the link on pages you open with `window.open`, pass
  `noopener`. The pop-up closes on accept or cancel as before.
- **`/auth`: one sign-in at a time.** Sign in is disabled while "Continue as" is
  being checked, and "Continue as {username} instead" is disabled while a
  password sign-in runs, so a second sign-in cannot start under a running one.

### Documentation

- README: `actAs` on the access request (who the access is for, on a platform
  with account delegation) and the `delegation` hint in the `ACCEPTED` answer.
- README, deploying: refuse framing on every page (`Content-Security-Policy:
  frame-ancestors 'none'` and `X-Frame-Options: DENY`, with the nginx lines);
  the consent pages must not be framable by another site (clickjacking). A host
  that cannot send headers should not be a trusted auth URL.

## 0.8.0 - 2026-09-30

### Added

- **`/auth` honours the `username` sign-in hint**
  ([#4](https://github.com/pryv/app-web-user-account/issues/4)), as `/signin`
  does: the form is pre-filled. When the browser holds a session for another
  account, the pre-filled form comes first and that session is offered as
  "Continue as {username} instead" (it is never signed out by the hint); a hint
  matching the stored session, or none, keeps the "Continue as" card. Deliver it
  on your `authUrl` query.
- **Deep link to the creation form.** `/account/delegation?create=1` scrolls the
  "Create a managed account" form into view and puts the cursor in its username
  field. `?create=1` survives the sign-in of a signed-out user; `#create` is
  honoured too when the user is already signed in.
- **A way on after creating an account.** When the page was opened with
  `backUrl` (and `backLabel`), a successful creation shows "Continue to
  {backLabel}" with the host under the success notice, a link back to the app.
  The notice is brought into view and the link focused.

### Changed

- **The delegation page leads with account creation**
  ([#7](https://github.com/pryv/app-web-user-account/issues/7)). `/account/delegation`
  now shows "Create a managed account" first, then "Accounts I manage", then
  "My delegates". A carer sent there to create an account for someone they
  look after lands on the form instead of two empty lists. Titles and copy are
  unchanged.

### Fixed

- **`/auth`: Cancel and completion no longer leave a dead page in a tab**
  ([#6](https://github.com/pryv/app-web-user-account/issues/6)). After the user
  accepts or cancels, the page closes the window as before; a pop-up opened by
  the app closes. A tab the page did not open (a phone reached by redirection)
  cannot be closed by script: a moment later it now goes back to `backUrl` when
  the app gave one (carry `backUrl` / `backLabel` on your `authUrl`), and
  otherwise shows "This request is complete" instead of the page it was on. A
  pop-up, or a page shown in a frame, is never sent to `backUrl`; the buttons
  stay disabled once the decision is sent.
- **`/auth`: "Create account" stays in the same window**
  ([#5](https://github.com/pryv/app-web-user-account/issues/5)). "Create account"
  and "Forgot password?" opened a new tab, where the person completed the request
  while the original pop-up stayed orphaned on its sign-in form. Both now open in
  the same window; they carry the pending request and the app's way back
  (`backUrl` / `backLabel`), which also survive the return to `/auth` after the
  account is created, and a pop-up still closes on completion.
- **A refused managed-account creation no longer shows the password.** When the
  platform refused the call with an error the page did not map (a weak password,
  a refusal, a server error), the alert showed the client library's error text,
  which embeds the request parameters, password included. The page now shows the
  platform's own message, or a generic one.

## 0.7.2 — 2026-09-30

### Fixed

- **Deep links answer 200 on a dedicated origin.** `npm run build:root` now writes
  one page per route (`auth.html`, `register.html`, `account/profile.html`, ...),
  so a server with GitHub Pages semantics, such as an open-pryv.io hosted site,
  answers `/auth?…` and the other entry points with status 200 instead of the
  404 fallback page (which rendered the app, but with the wrong status). The
  `/account` shell keeps `account/index.html`; dynamic routes still use
  `404.html`.

## 0.7.1 — 2026-09-29

### Changed

- **`@pryv/cmc` 3.17.0.** The approval pages use the version whose accept result
  no longer declares `dataGrantApiEndpoint` (matching what this app already hands
  back), and whose popup helpers only trust the popup they opened. No behaviour
  change in this app.
- **Two production builds.** `npm run build:root` builds for the root of a
  dedicated origin (what a platform serves as a hosted site, and what a release
  ships as `app-web-user-account-<version>-root.tar.gz`); `npm run build:pages`
  builds the GitHub Pages copy under `/app-web-user-account/` again and no longer
  writes a `CNAME`. The reference copy moves to `https://account.pryv.me/`,
  served by the pryv.me platform itself; the GitHub Pages copy stays as a
  fallback demo on the shared `pryv.github.io` origin.

## 0.7.0 — 2026-09-25

### Added

- **Light / dark theme choice.** The operator sets the default in `settings.json`
  (`"theme": { "default": "system" | "light" | "dark" }`, `system` when unset,
  which follows the OS as before). A toggle in the header lets the user pick
  follow the system, light or dark; the pick is kept in `localStorage` under
  `pryv.theme` and survives a reload. `"userChoice": false` hides the toggle and
  always applies the operator default. The palette is driven by
  `<html data-theme="light|dark">`, so a rebrand can target either theme.

### Changed

- **Smaller font payload: only the weights and scripts the UI uses ship.**
  `src/brand.css` imported seven full fontsource faces, each carrying every
  script subset. It now imports the latin and latin-ext files of Roboto 400,
  500 and 700 and Roboto Condensed 500 and 700. Roboto 300 and Roboto
  Condensed 400 are dropped: no style uses them. The build output goes from
  100 font files (1.5 MB, 796 KB of it woff2) to 20 (392 KB, 200 KB woff2).
  A browser only ever downloaded the subsets a page displayed, so what changes
  is mostly deploy size and build time. The latin files are declared last, so
  a page in plain Latin text downloads only those.
- **i18n trade-off:** Cyrillic, Greek, Vietnamese and the math and symbol
  subsets no longer ship; latin-ext still covers Western and Central European
  languages. An operator adding a language in another script adds the matching
  subset imports to `src/brand.css` (README, Localisation, step 4); until then
  that text renders in the fallback system font. A unit test (`[FNTS]`) keeps
  full-weight imports from coming back by accident.
- **Consistent action icons.** On the Profile page, "Send verification link"
  and "Add an email" now carry an icon like their neighbour "Edit". The
  Previous / Next buttons of the access log use icons instead of the text
  arrows `←` / `→`, which screen readers announced as part of the button name.
  The icon rule is documented in `src/components/ui.tsx` and the README.
- **The cross-account approval page is covered end to end.** A hermetic
  Playwright spec drives `/cmc-accept` against mocked cores, from reading the
  offer to the result handed back: approve and decline in redirect mode, approve
  and a consumed link in popup mode (the opener receives the result and the
  popup closes), and the consumed-link notice shown as information. It checks
  the triggers written on the account and the exact result handed back.
- **The approval result is the outcome only, stated as such.** `/cmc-accept`
  hands back `{ ok, acceptEventId }` (or `{ ok: false, reason }`) by redirect or
  `postMessage`. It had a branch that sent a `dataGrantApiEndpoint` to
  operator-trusted origins, but `@pryv/cmc` never returns one: the platform
  records the data-grant access without its token. The dead branch and its
  origin check are removed; the requesting app obtains its endpoint on its own
  side with `@pryv/cmc` `waitForAccept` (`grantedAccessApiEndpoint`).
- **The reference copy moves to its own origin, `https://account.pryv.me/`.**
  It was served from `https://pryv.github.io/app-web-user-account/`, an origin
  shared with other project pages, any of which could read the signed-in
  session (and its personal token) from `localStorage`. `npm run build:pages`
  now builds for the root path and writes the `CNAME`; the old address
  redirects to the new one. Users of the published copy sign in again once.
  Self-hosted deployments are not affected.

### Fixed

- **The cross-account approval pages work on the development server.**
  `@pryv/cmc` is CommonJS and was re-exported with `export * as cmc`, which the
  Vite dev server does not pass through its CommonJS interop: `/cmc-accept` and
  `/cmc-scope-update` failed with "cmc.readOffer is not a function" under
  `npm run dev`. Production builds were not affected.

## 0.6.1 — 2026-09-25

### Fixed

- **`allowedServiceInfoUrls` no longer refuses every `/auth` request on real
  platforms** ([#3](https://github.com/pryv/app-web-user-account/issues/3)).
  The poll URL's platform was guessed from its path (`…/reg/access/<key>`), which
  never matched: open-pryv.io serves poll URLs from the core that took the
  request (`https://core-a.example.com/reg/access/<key>`) or from the register
  (`https://reg.example.com/access/<key>`). The poll URL is now accepted when it
  is served from an origin the allowed platform's own service info declares
  (`register`, `access`, `api`, and the hosts one label under a
  `https://{username}.example.com/` api, not the apex), plus the trusted API
  origins (`trustedApiOrigins` and `VITE_OAUTH_TRUSTED_API_ORIGINS`). It must be
  a bare https access-request URL. The allowed platform's service info is read
  from the operator-configured URL only, never from the poll host; if it cannot
  be read, the request is refused. Sign-in, the register / reset links and the
  displayed platform details use that allowed platform.

## 0.6.0 — 2026-09-25

### Added

- **The UI is translatable.** Every screen reads its text from
  `src/locales/en.json` (i18next); adding a language is one catalog file plus
  three lines in `src/i18n.ts`, and a parity test keeps catalogs complete (see
  "Localisation" in the README). English only ships for now.
- **Language choice:** `?lang=` on a link wins for that visit, then the
  account's language after sign-in, then the browser's, then English. The
  profile's language selector saves the account language and switches the UI
  (shown once more than one language ships). Registration sends the current
  language to the platform instead of always English.
- Dependencies: `i18next`, `react-i18next`, `i18next-browser-languagedetector`
  (no known vulnerabilities).

### Changed

- The English wording is unchanged; the brand words in copy come from
  `src/brand.tsx` through the catalog.

## 0.5.0 — 2026-09-25

### Added

- **Consent screens name the app from the operator's catalog.** `/auth` and
  `/oauth2-authorize` show the requesting app's name, icon and description from
  `settings.json` `appCatalogUrl` (schema in the README). An app not in the
  catalog shows its raw id, never a name it supplies about itself.
- **Extension points for forks and operators** (see "Extension points" in the
  README): `src/lib/pryvClient.ts` (the only module importing the Pryv client
  libraries, enforced by a test), `src/brand.tsx` / `src/brand.css` (product
  name, account noun, logo, fonts), `src/accountTabs.tsx` + `src/routes.json`
  (account tabs and extra pages, with a test that keeps the static-hosting
  fallback in step), `src/extensions/ProfileExtensions.tsx` (extra profile
  sections), `src/extensions/streamLabels.ts` (stream labels on consent rows),
  and `src/components/consent/ConsentPanel.tsx` (the consent screen layout).
- `SelectField` form component. The profile's language becomes selectable when
  more than one language is offered.

### Changed

- The access-request and OAuth2 consent screens render one shared
  `ConsentPanel`; markup and wording are unchanged, except that on
  `/oauth2-authorize` the `oauthClientIdText` id now sits on the app name
  itself (its text is the catalog's name when the catalog knows the app).
- The stream-label seam also labels the rows of `/cmc-accept` and
  `/cmc-scope-update`.

### Security

- **`/cmc-accept` names the requester by its account.** The approval page used
  to show the requester's self-chosen display name in place of the account the
  capability belongs to, so a request could present itself as anyone. It now
  shows the verified `username@host` and, when present, the display name only as
  "calls itself …". Without a verified account it says "An unidentified
  requester".
- Fonts load from `src/brand.css`; the Register and OAuth2 copy use the brand's
  account noun.

## 0.4.1 — 2026-09-24

### Security

- **A deployment can restrict which platforms it serves.** Until now any link
  could point the sign-in, registration, password-reset, third-party sign-in
  and `/auth` pages at any platform through `pryvServiceInfoUrl` (or an access
  request's poll URL), so a crafted link on a legitimate account domain could
  send a user's password to someone else's server. New `settings.json` key
  `allowedServiceInfoUrls`: when set, only those platforms and the default
  `serviceInfoUrl` are served, and any other is refused before a password can be
  typed. On `/auth` both the service-info in the link and the platform of the
  poll URL must be served, so a granted token cannot be posted to someone
  else's poll URL. An empty list means the default platform only. Opt-in (the
  key absent keeps today's behaviour); recommended for every deployment that
  serves a single platform.
- The README now states that the app must be served from its own origin (the
  session, stored in `localStorage`, holds the user's personal token and is
  readable by every page of that origin), and marks the copy published under
  `pryv.github.io` as a demo.

## 0.4.0 — 2026-09-24

### Added

- **Per-deployment `settings.json`.** A file served next to the app, read once
  at start-up (never more than 4 seconds; a missing or broken file changes
  nothing), configures a deployment without rebuilding it: the default
  platform, extra trusted core origins, Terms and Privacy links, and an app
  catalog URL. Only absolute http(s) URLs are accepted. The shipped file is
  `{}`, so existing deployments behave as before. See "Deploy: settings.json" in
  the README.
- **`pryvServiceInfoUrl` is optional when `settings.json` sets
  `serviceInfoUrl`.** Links from an app, mailed links and a cold sign-in work
  without it; the URL parameter still wins when present. A session opened
  without the parameter is stored against the deployment's platform, so it
  survives a reload.
- **Trusted core origins at deploy time.** `settings.json`
  `trustedApiOrigins` is added to the build-time
  `VITE_OAUTH_TRUSTED_API_ORIGINS` for the OAuth2 consent page and CMC result
  delivery. Entries are compared as exact origins (scheme, host, port), invalid
  ones are ignored (and plain `http` is kept for loopback only), and the list is
  never read from the URL; a production build
  with both lists empty still refuses every `pryvApi`.
- **Terms acceptance at registration.** When the deployment names its Terms or
  Privacy policy (`settings.json` `legal`, or the platform's service-info
  `terms`), registering requires ticking "I accept the Terms of use and have
  read the Privacy policy", with links in the user's language. With no document
  named, the form is unchanged.

### Changed

- With neither `pryvServiceInfoUrl` nor `settings.json`, the error now points
  the operator at `settings.json`.
- An entry of `VITE_OAUTH_TRUSTED_API_ORIGINS` with a path or a trailing slash
  now matches its origin (it never matched before); a value made only of invalid
  entries no longer blocks development builds (production still fails closed).
- `npm run build:pages` refuses to build when `node_modules` does not match
  `package-lock.json`.

## 0.3.0 — 2026-09-24

### Added

- **`username` sign-in hint.** `/signin?username=alice` pre-fills the username
  field, like OIDC's `login_hint`, for an app that already knows who the user
  is. It fills the field only while it is empty, never replaces typed input, and
  grants nothing (the password is still required). `/register` ignores it.

### Fixed

- **A signed-out deep link into the account section comes back to the page it
  asked for.** Opening `/account/security` (or any account page, or
  `/change-password`) while signed out used to land on the profile after sign-in,
  and `backUrl` / `backLabel` were lost on the way. The guard now sends the page
  along as `returnTo` (a same-origin account path, validated; never a URL) and
  keeps `username`, `backUrl` and `backLabel` across the sign-in. A third-party
  sign-in returns to the page wherever it lands, and keeps the back link when it
  comes back to the same browser tab. When no page was asked for, the profile
  keeps them too.
- The end-to-end smoke test for `/oauth2-authorize` expected the placeholder
  heading the page had before the consent flow shipped; it now checks the
  refusal shown when the page is opened without its parameters. New hermetic
  end-to-end specs cover delegation (banner, warning copy) and email
  verification.

### Changed

- **Re-approving an app whose access has changed now updates that access in
  place.** When an app asks for permissions that differ from the access it
  already holds, `/auth` used to delete that access and create a new one, which
  rotated its token and could leave other holders of the old token (another
  device, a cached session) with a dead credential. Approving now updates the
  existing access (`accesses.update`): same access, same token, new
  permissions. If the register then refuses the grant, the updated access is
  left in place (it predates the request) instead of being deleted. The
  consent screen says "Approving will update it." Apps that proposed their own
  token in the access request are unaffected: their prior access is still
  replaced (delete + create) so they get the token they asked for.
- Sign-in completion order is now: a pending access request, `returnURL`,
  `returnTo`, the approval hand-off `next`, then the profile.
- **The delegated-session reminder shows on every page, and follows the
  server.** It used to appear only inside the account section and only when
  this browser remembered starting the delegated session. It now sits under the
  header on every route (including `/auth`) and is driven first by the core's
  `access-info` `delegation` field, so a delegated session opened elsewhere, or
  whose local record was cleared, is still flagged; "Back to …" is offered when
  this browser can return to the delegate's own session.
- Tests are type-checked by their own `tsconfig.test.json` (with the Node
  types), so a test may import a Node built-in such as `node:fs` without breaking
  `npm run build`. The app config now excludes test files; `tsc -b` still checks
  them.

## 0.2.4 — 2026-09-24

### Security

- **The access-request return URL no longer carries the app's token.** After an
  access request, `/auth` redirected to the calling app's `returnURL` with every
  field of the request state appended as `prYv<field>`, which included the newly
  created app token, the `apiEndpoint` that embeds it, and the username. They
  ended up in the calling page's address bar, browser history and `Referer`. The
  return URL now carries only `prYvpoll`, `prYvkey` and `prYvstatus`. Apps using
  the `pryv` client library need no change: it reads just the poll URL (or key)
  and fetches the rest from it.
  **BREAKING for hand-rolled consumers:** an app that read `prYvtoken`,
  `prYvapiEndpoint`, `prYvusername` or any other `prYv*` field from its return
  URL (as the legacy auth pages documented) must now fetch the `prYvpoll` URL,
  whose answer carries the same state.

### Fixed

- **Creating an account or resetting a password from an app's access request no
  longer loses the request.** The "Create account" and "Forgot password?" links
  on the `/auth` sign-in screen now carry the pending request, and a sign-in or
  registration that has one returns to `/auth` to finish the grant, instead of
  landing on the profile while the app keeps waiting.
- **The consent screen shows the app's own message.** An app's
  `clientData["app-web-auth:description"]` was shown only when reviewing an access
  afterwards; `/auth` now displays it above the permission list (as text with
  light formatting, never as HTML).
- **The "Send verification link" button on the profile no longer breaks onto
  three lines** in a narrow column; the email actions move to their own row.

### Changed

- Registration now shares the sign-in completion decision (pending access
  request, then `returnURL`, then a hand-off `next`, then the profile) instead of
  a copy of it.
- `backloop.dev.json` (the local HTTPS certificate secret) is git-ignored.

## 0.2.3 — 2026-09-22

### Fixed

- **Third-party sign-in now finishes the flow you started.** Signing in with a
  provider used to land on the account profile and forget the calling app's
  `returnURL` and `state`; arriving from an approval link (`/cmc-accept`,
  `/cmc-scope-update`) forgot the link itself. The sign-in page now hands the core
  an opaque return context (never a credential, and never the service-info URL),
  which comes back on the landing page and is applied exactly as it is after a
  password sign-in; the approval link itself stays in this browser tab and is
  restored when the sign-in returns to it. With a core that does not echo the
  return context, the same-tab restore still works.
- **After a second factor, the profile fallback keeps `pryvServiceInfoUrl`.**
  Completing an MFA challenge without a `returnURL` or a hand-off sent the user to
  `/account`, dropping the platform the session belonged to; it now goes to the
  same `/account/profile?pryvServiceInfoUrl=…` every other sign-in path uses.

### Changed

- Password, second-factor and third-party sign-in now share one completion
  decision (`returnURL`, then a hand-off `next`, then the profile) instead of
  re-implementing it three times.

## 0.2.2 — 2026-09-18

### Fixed

- **`/cmc-accept` explains why an approval failed.** A link that cannot be read
  (invalid or expired) now says so when the page opens, instead of showing the raw
  API response. On approving, a link already used, a request the app withdrew, or
  a request you already approved shows a plain message instead of the raw
  `CMC accept failed: cmc-capability-…` error; when the platform is still
  processing the approval at the end of the wait, the page says so and asks not
  to approve again. Outcomes that are not errors for you show as information.
- **`/cmc-accept` and `/cmc-scope-update` no longer show the client library's
  wrapper message for an API refusal.** That message embedded the call's
  parameters (on `/cmc-accept`, the token-bearing approval link) and was also
  handed back to the calling app as the failure reason. The pages now show the
  platform's own error message and hand back its error id.

### Changed

- The failure `reason` that `/cmc-accept` hands back to the calling app is now the
  platform's error id (for example `cmc-capability-consumed`) whenever there is
  one; it was the English error message. This matches what the `@pryv/cmc`
  documentation describes for `requestAccept` (the caller receives it as the
  `CmcError` id) and what `/cmc-scope-update` already did.

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
