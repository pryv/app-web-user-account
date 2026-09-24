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

export * as cmc from "@pryv/cmc";
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
