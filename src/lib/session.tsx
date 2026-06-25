import { createContext, useContext, useState, type ReactNode } from "react";

/** Minimal shape of a Pryv `Connection` that the account pages rely on. */
export interface PryvConnection {
  apiEndpoint: string;
  username(): Promise<string>;
  accessInfo(forceRefresh?: boolean): Promise<unknown>;
  api(calls: Array<{ method: string; params: unknown }>): Promise<unknown[]>;
}

interface Session {
  connection: PryvConnection | null;
  setConnection: (c: PryvConnection | null) => void;
}

const SessionContext = createContext<Session | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<PryvConnection | null>(null);
  return (
    <SessionContext.Provider value={{ connection, setConnection }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
