import type { ReactNode } from "react";
import type { PryvConnection } from "../lib/session";
import type { AccessDetails } from "../lib/audit";

/**
 * Access details extension slot, rendered on the access details page
 * (`/account/audit-access/:accessId`) between the access details card and the
 * audit trail card, once the access is loaded. Renders nothing here; a fork
 * replaces this file to show what its integration knows about an access (for
 * example which form or study a consent belongs to).
 *
 * `access` is the access as the page loaded it; `isSelf` is true when it is
 * the access the current session runs on. `isSelf` is resolved by a separate
 * request: it can be `false` on the first render and become `true` later (it
 * stays `false` if that request fails), so read it on every render rather than
 * once on mount. The slot only adds content: it cannot change the details card,
 * the revoke button or the audit trail.
 */
export default function AccessExtras(_props: {
  connection: PryvConnection;
  access: AccessDetails;
  isSelf: boolean;
}): ReactNode {
  return null;
}
