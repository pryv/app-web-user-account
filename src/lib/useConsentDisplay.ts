/**
 * The two background lookups a consent screen needs: the requesting app's
 * curated identity (app catalog) and the deployment's stream labels.
 *
 * Both are deliberately **progressive**: the screen renders immediately with
 * what it already has (the raw app id, the request's stream names) and
 * upgrades in place when the lookup lands. Neither may delay, block or break
 * consent. Kept in one module because every consent route (`Auth`,
 * `Oauth2Authorize`, `CmcApprove`) needs the same behaviour.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAppCatalog, resolveRequestingApp, type CatalogIcon } from "./appCatalog";
import { getStreamLabels, NO_STREAM_LABELS, type StreamLabelResolver } from "./streamLabels";

export interface RequestingAppDisplay {
  name: string;
  description: string | null;
  icon: CatalogIcon | null;
}

/**
 * Resolve a requesting app id to its operator-curated identity.
 *
 * `null` means "the catalog cannot vouch for this id": callers keep showing
 * the raw id, which is the honest rendering. Never returns anything the
 * requesting app itself supplied.
 */
export function useRequestingApp(
  appId: string | null | undefined,
  serviceInfoUrl: string | null,
): RequestingAppDisplay | null {
  // The UI language (`?lang=`, the account's, the browser's, then English),
  // so the app is named in the language the rest of the screen uses.
  const { i18n } = useTranslation();
  const language = i18n.language || "en";
  const [app, setApp] = useState<RequestingAppDisplay | null>(null);

  useEffect(() => {
    if (appId == null || appId === "" || serviceInfoUrl == null) {
      setApp(null);
      return;
    }
    let cancelled = false;
    void getAppCatalog(serviceInfoUrl).then((catalog) => {
      if (!cancelled) setApp(resolveRequestingApp(catalog, appId, language));
    });
    return () => {
      cancelled = true;
    };
  }, [appId, serviceInfoUrl, language]);

  return app;
}

/**
 * The deployment's stream-label resolver for the platform at `serviceInfoUrl`.
 *
 * Starts as {@link NO_STREAM_LABELS}, so the first paint needs nothing, then
 * swaps in the loaded resolver.
 */
export function useStreamLabels(serviceInfoUrl: string | null): StreamLabelResolver {
  const [resolver, setResolver] = useState<StreamLabelResolver>(() => NO_STREAM_LABELS);

  useEffect(() => {
    if (serviceInfoUrl == null) return;
    let cancelled = false;
    void getStreamLabels(serviceInfoUrl).then((r) => {
      // Stored via the updater form: a bare `setResolver(r)` would call `r`,
      // since React treats a function value as a state updater.
      if (!cancelled) setResolver(() => r);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceInfoUrl]);

  return resolver;
}
