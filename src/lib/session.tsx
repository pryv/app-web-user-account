import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Pryv from "pryv";

/** Minimal shape of a Pryv `Connection` that the account pages rely on. */
export interface PryvConnection {
  apiEndpoint: string;
  /** Same as apiEndpoint but with the bearer token stripped (safe to share). */
  endpoint: string;
  username(): Promise<string>;
  accessInfo(forceRefresh?: boolean): Promise<unknown>;
  api(calls: Array<{ method: string; params: unknown }>): Promise<unknown[]>;
}

interface Session {
  connection: PryvConnection | null;
  setConnection: (c: PryvConnection | null, serviceInfoUrl?: string | null) => void;
}

const SessionContext = createContext<Session | undefined>(undefined);

const STORE_KEY_API = "pryv.session.apiEndpoint";
const STORE_KEY_SERVICE = "pryv.session.serviceInfoUrl";

function readStored(): PryvConnection | null {
  try {
    const apiEndpoint = localStorage.getItem(STORE_KEY_API);
    const serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE);
    if (!apiEndpoint || !serviceInfoUrl) return null;
    const service = new Pryv.Service(serviceInfoUrl);
    return new Pryv.Connection(apiEndpoint, service) as unknown as PryvConnection;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnectionState] = useState<PryvConnection | null>(() => readStored());

  const setConnection = (c: PryvConnection | null, serviceInfoUrl?: string | null) => {
    if (c) {
      try {
        localStorage.setItem(STORE_KEY_API, c.apiEndpoint);
        if (serviceInfoUrl) localStorage.setItem(STORE_KEY_SERVICE, serviceInfoUrl);
      } catch {
        // localStorage may be unavailable (private mode); fall back to in-memory only.
      }
    } else {
      try {
        localStorage.removeItem(STORE_KEY_API);
        localStorage.removeItem(STORE_KEY_SERVICE);
      } catch {
        // Same as above.
      }
    }
    setConnectionState(c);
  };

  // Re-hydrate if another tab in the same origin updates the session.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY_API || e.key === STORE_KEY_SERVICE) {
        setConnectionState(readStored());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
