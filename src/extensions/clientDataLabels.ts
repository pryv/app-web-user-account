/**
 * Extension point: labels of client data rows.
 *
 * The access card and the access page show an access's `clientData` as rows,
 * one per dotted path (`oauth.client.host`, `cmc.counterparty.username`, ...).
 * Replace this file in a fork to label the keys your integration writes.
 * `clientDataLabel(path)` returns a label for that path, or `null` to fall
 * back to the built-in labels (`src/lib/clientDataLabels.ts`), then to the
 * path itself. Synchronous: labels are static.
 *
 * The string is a catalog key (`src/locales/*.json`) or literal text, as for
 * tab labels: a key the catalog has is translated, anything else is shown as
 * it is. A fork that wants localised labels adds its keys to its locale files.
 *
 * The default labels nothing.
 */

export function clientDataLabel(_path: string): string | null {
  return null;
}
