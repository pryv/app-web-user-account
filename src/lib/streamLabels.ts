/**
 * Display labels for the streams a consent screen lists.
 *
 * A permission row names its stream with whatever the core or the requesting
 * app supplied (`name ?? defaultName ?? streamId`). A deployment that knows its
 * data model better (curated, localized stream labels) plugs a resolver in
 * through `src/extensions/streamLabels.ts`; this module is the stable side of
 * that seam: it memoises the resolver and guarantees it never breaks consent.
 *
 * **Never blocks consent.** Callers render with the names they already have
 * and upgrade in place once the resolver lands. A failing extension resolves to
 * {@link NO_STREAM_LABELS}, so the result can be used unconditionally.
 */

import { loadStreamLabels } from "../extensions/streamLabels";

/** Resolves a `streamId` to a label, or `null` when it cannot speak for that stream. */
export type StreamLabelResolver = (streamId: string) => string | null;

/** A resolver that knows nothing: the shape used before, or without, an extension. */
export const NO_STREAM_LABELS: StreamLabelResolver = () => null;

let cache: { url: string; resolver: Promise<StreamLabelResolver> } | null = null;

/** Drop the memoised resolver (tests, and any future explicit refresh). */
export function resetStreamLabels(): void {
  cache = null;
}

/**
 * The stream-label resolver for the platform at `serviceInfoUrl`.
 *
 * Memoised per service-info URL, because a `pryvServiceInfoUrl` link can point
 * this app at another platform with another data model. Never rejects.
 */
export function getStreamLabels(serviceInfoUrl: string): Promise<StreamLabelResolver> {
  if (cache?.url !== serviceInfoUrl) {
    cache = { url: serviceInfoUrl, resolver: load(serviceInfoUrl) };
  }
  return cache.resolver;
}

async function load(serviceInfoUrl: string): Promise<StreamLabelResolver> {
  try {
    const resolver = await loadStreamLabels(serviceInfoUrl);
    return typeof resolver === "function" ? resolver : NO_STREAM_LABELS;
  } catch (err) {
    // A warning, not a throw: a consent screen degrades, it does not fail.
    console.warn("[streamLabels] stream labels unavailable:", err);
    return NO_STREAM_LABELS;
  }
}

/**
 * A resolver over an account's stream tree (`streams.get` answer): each
 * stream's own name, children included. Anything malformed is skipped.
 */
export function streamNamesResolver(streams: unknown): StreamLabelResolver {
  const names = new Map<string, string>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (s == null || typeof s !== "object") continue;
      const { id, name, children } = s as { id?: unknown; name?: unknown; children?: unknown };
      if (typeof id === "string" && typeof name === "string" && name !== "") names.set(id, name);
      walk(children);
    }
  };
  walk(streams);
  return names.size === 0 ? NO_STREAM_LABELS : (streamId) => names.get(streamId) ?? null;
}
