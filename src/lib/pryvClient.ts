/**
 * The one place this app imports the Pryv client libraries from.
 *
 * Every other module imports `pryv` and the `@pryv/*` add-ons through this
 * file (a test enforces it). A fork that consumes the client through its own
 * wrapper library replaces this file's body and nothing else.
 */

import Pryv from "pryv";
import attachSocketIO from "@pryv/socket.io";

export { Pryv, attachSocketIO };

// Imported, then exported: `@pryv/cmc` is CommonJS, and the Vite dev server
// only applies its CommonJS interop to imports. A direct `export * as cmc`
// left `cmc` holding just `default`, so every `cmc.<fn>` threw "is not a
// function" under `npm run dev` (the production build was not affected).
import * as cmcModule from "@pryv/cmc";
export const cmc = cmcModule;
export { errorIds as cmcErrorIds } from "@pryv/cmc";

export {
  Delegation,
  DelegationError,
  errorIds as delegationErrorIds,
  STATUS as delegationStatus,
} from "@pryv/delegation";
export type {
  DelegateRecord,
  ControlledRecord,
  RelationshipStatus,
} from "@pryv/delegation";
