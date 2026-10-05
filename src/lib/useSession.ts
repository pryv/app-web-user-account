import { createContext, useContext } from "react";
import type { ActingAs, PryvConnection } from "./sessionStore";

/** The session the pages read and change, provided by `SessionProvider` (lib/session.tsx). */
export interface Session {
  connection: PryvConnection | null;
  /** Replace the session (sign-in, sign-out). Ends any "acting as". */
  setConnection: (c: PryvConnection | null, serviceInfoUrl?: string | null) => void;
  actingAs: ActingAs | null;
  /** Act on a controlled account: keep the current session to return to. */
  actAs: (c: PryvConnection, who: ActingAs) => void;
  /** Return to the session kept by `actAs`. */
  backToParent: () => void;
}

export const SessionContext = createContext<Session | undefined>(undefined);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
