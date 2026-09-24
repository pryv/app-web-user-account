/**
 * Extension point: stream labels on consent screens.
 *
 * Replace this file in a fork to show curated (for example localized) stream
 * labels on the consent permission rows. Return a function mapping a
 * `streamId` to a label, or to `null` to keep the name the request carries.
 * It is loaded in the background and may fail: `lib/streamLabels.ts` turns a
 * rejection into "no labels", so the consent screen is never blocked.
 *
 * The default knows no labels.
 */

import { NO_STREAM_LABELS, type StreamLabelResolver } from "../lib/streamLabels";

export async function loadStreamLabels(_serviceInfoUrl: string): Promise<StreamLabelResolver> {
  return NO_STREAM_LABELS;
}
