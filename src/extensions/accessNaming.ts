/**
 * Extension point: how the account pages name an access.
 *
 * Every access card (sessions on Security, apps on Connected apps) calls this
 * hook once, unconditionally, with the signed-in connection and the entry it
 * shows: `access`, plus the OAuth sessions folded under it (`sessions`, empty
 * for a single access). The Audit trail's Access column calls it too, once per
 * row (up to 15 rows a page, each its own instance), so an asynchronous
 * replacement should cache what it resolves by `entry.access.id` (a module
 * level map, or a context), or it fetches once per row on every page.
 * Return `{ label, host?, icon? }` to name it, or `null`
 * to keep the default naming (`entryNaming` in `src/lib/oauthClient.ts`: the
 * OAuth client stamp, the client id, else the access name).
 *
 * The hook may resolve the name asynchronously (read the access's own
 * manifest pointer in `entry.access.clientData`, fetch a catalogue, read an
 * event through `connection`, ...): return `null` while loading, then the
 * name once known; the card renders with the default name until then.
 *
 * Rules for a replacement:
 * - It is a React hook: call other hooks unconditionally, never throw (a throw
 *   breaks the page; catch and return `null`).
 * - `entry` is a new object on every render: depend on `entry.access.id` (and
 *   what you read from it), not on `entry`, in your effects and memos.
 * - `connection` is `null` while no session is open; it is the delegated
 *   session while the pages act for a managed account.
 * - `icon` is a `CatalogIcon` (`src/lib/appCatalog.ts`: an emoji, an http(s)
 *   URL or a raster image data URL), shown in a 20 px slot left of the name.
 *   The image is loaded by the viewer's browser: take its URL from a source
 *   you trust (your catalogue), not from what an access says about itself.
 * - `label` and `host` are shown as text, never as HTML.
 *
 * The default names nothing.
 */

import type { PryvConnection } from "../lib/session";
import type { AccessNaming, OAuthAccessLike } from "../lib/oauthClient";

export function useAccessNaming(
  _connection: PryvConnection | null,
  _entry: { access: OAuthAccessLike; sessions: OAuthAccessLike[] },
): AccessNaming | null {
  return null;
}
