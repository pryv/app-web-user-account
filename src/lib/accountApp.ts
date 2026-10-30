/**
 * The appId this app signs in with on the `/auth` consent: the personal
 * session is this app's, never the requesting app's, so the account lists it
 * under this app's name.
 */
export const ACCOUNT_APP_ID = "pryv-app-web-user-account";

/**
 * The appId of the OAuth consent's sign-in (`/oauth2-authorize`), kept apart
 * from {@link ACCOUNT_APP_ID}. The core hands a login back any live session of
 * the same appId, from any device, and the consent ends its session once it
 * is answered: with an appId of its own it can only ever be handed, and end,
 * another consent's session, never a session the account app uses elsewhere.
 *
 * Residual: two consents running at the same time on two devices share one
 * session, so the first to finish ends the other's; that one's Accept is then
 * refused and the page asks for a new sign-in.
 */
export const ACCOUNT_APP_CONSENT_ID = "pryv-app-web-user-account-consent";
