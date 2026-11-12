/**
 * The label of a client data row (see `clientDataView.ts`), in this order:
 * the fork's `src/extensions/clientDataLabels.ts`, the built-in table below,
 * then the path itself. A label is a catalog key or literal text.
 */

import i18n from "../i18n";
import { clientDataLabel as extensionLabel } from "../extensions/clientDataLabels";

/** Built-in labels: client data keys the platform and its libraries write. */
export const BUILT_IN_CLIENT_DATA_LABELS: Readonly<Record<string, string>> = {
  "oauth.client.name": "clientData.labels.oauthClientName",
  "oauth.client.host": "clientData.labels.oauthClientHost",
  "oauth.client.url": "clientData.labels.oauthClientUrl",
  "oauth.client.origin": "clientData.labels.oauthClientOrigin",
  "oauth.dataGrantId": "clientData.labels.oauthDataGrantId",
  "oauth.exchange": "clientData.labels.oauthExchange",
  "delegation.kind": "clientData.labels.delegationKind",
  "delegation.relId": "clientData.labels.delegationRelId",
  "delegation.delegate.username": "clientData.labels.delegationDelegateUsername",
  "delegation.delegate.hostSlug": "clientData.labels.delegationDelegateHostSlug",
  "delegation.capabilityUrl": "clientData.labels.delegationCapabilityUrl",
  "cmc.counterparty.username": "clientData.labels.cmcCounterpartyUsername",
  "cmc.counterparty.apiEndpoint": "clientData.labels.cmcCounterpartyApiEndpoint",
  "cmc.backChannelApiEndpoint": "clientData.labels.cmcBackChannelApiEndpoint",
};

function translate(label: string): string {
  return i18n.t(label, { defaultValue: label });
}

/** The label to show for the row at `path`. */
export function clientDataLabel(path: string): string {
  let fromExtension: string | null = null;
  try {
    fromExtension = extensionLabel(path);
  } catch (err) {
    console.warn("[clientDataLabels] extension failed:", err);
  }
  if (typeof fromExtension === "string" && fromExtension !== "") return translate(fromExtension);
  const builtIn = BUILT_IN_CLIENT_DATA_LABELS[path];
  if (builtIn != null) return translate(builtIn);
  return path;
}
