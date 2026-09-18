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
  /** The lib-js Service this connection was built from; `.info()` returns the
   *  service-info (used to read `features.mfa.methods` and the
   *  `features.emailVerification` flags). */
  service: {
    info(forceFetch?: boolean): Promise<
      {
        features?: {
          mfa?: { methods?: string[] };
          emailVerification?: { atRegistration?: boolean; onAccount?: boolean };
        };
      } & Record<string, unknown>
    >;
  };
}

/** Set while the session acts on an account the signed-in user controls. */
export interface ActingAs {
  username: string;
  parentUsername: string;
}

interface Session {
  connection: PryvConnection | null;
  /** Replace the session (sign-in, sign-out). Ends any "acting as". */
  setConnection: (c: PryvConnection | null, serviceInfoUrl?: string | null) => void;
  actingAs: ActingAs | null;
  /** Act on a controlled account: keep the current session to return to. */
  actAs: (c: PryvConnection, who: ActingAs) => void;
  /** Return to the session kept by `actAs`. */
  backToParent: () => void;
}

const SessionContext = createContext<Session | undefined>(undefined);

const STORE_KEY_API = "pryv.session.apiEndpoint";
const STORE_KEY_SERVICE = "pryv.session.serviceInfoUrl";
const STORE_KEY_PARENT_API = "pryv.session.parent.apiEndpoint";
const STORE_KEY_ACTING = "pryv.session.actingAs";

/**
 * Build the `/signin` path with `pryvServiceInfoUrl` preserved.
 *
 * Prefers the URL passed in (typically `useLocation().search`), so a
 * just-opened `/account/...` deep-link keeps its service-info on the
 * round-trip to /signin. Falls back to the last persisted session's
 * service-info URL so a clean sign-out → sign-in lands the user on the
 * right Pryv instance without needing the calling app to re-include the
 * param.
 */
export function signinPath(searchOrUndefined?: string): string {
  let serviceInfoUrl: string | null = null;
  if (searchOrUndefined) {
    const sp = new URLSearchParams(searchOrUndefined);
    serviceInfoUrl = sp.get("pryvServiceInfoUrl");
  }
  if (!serviceInfoUrl) {
    try {
      serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE);
    } catch {
      serviceInfoUrl = null;
    }
  }
  if (!serviceInfoUrl) return "/signin";
  return "/signin?pryvServiceInfoUrl=" + encodeURIComponent(serviceInfoUrl);
}

/** Service-info URL of the persisted session (platform-match checks). */
export function storedServiceInfoUrl(): string | null {
  try {
    return localStorage.getItem(STORE_KEY_SERVICE);
  } catch {
    return null;
  }
}

function connectionFor(apiEndpoint: string | null): PryvConnection | null {
  try {
    const serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE);
    if (!apiEndpoint || !serviceInfoUrl) return null;
    const service = new Pryv.Service(serviceInfoUrl);
    return new Pryv.Connection(apiEndpoint, service) as unknown as PryvConnection;
  } catch {
    return null;
  }
}

function readStored(): PryvConnection | null {
  try {
    return connectionFor(localStorage.getItem(STORE_KEY_API));
  } catch {
    return null;
  }
}

function readActingAs(): ActingAs | null {
  try {
    const raw = localStorage.getItem(STORE_KEY_ACTING);
    if (!raw || !localStorage.getItem(STORE_KEY_PARENT_API)) return null;
    const parsed = JSON.parse(raw) as Partial<ActingAs>;
    if (typeof parsed.username !== "string" || typeof parsed.parentUsername !== "string") return null;
    return { username: parsed.username, parentUsername: parsed.parentUsername };
  } catch {
    return null;
  }
}

function clearStack(): void {
  try {
    localStorage.removeItem(STORE_KEY_PARENT_API);
    localStorage.removeItem(STORE_KEY_ACTING);
  } catch {
    // localStorage unavailable: nothing was stored.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnectionState] = useState<PryvConnection | null>(() => readStored());
  const [actingAs, setActingAs] = useState<ActingAs | null>(() => readActingAs());

  function storeActive(c: PryvConnection | null, serviceInfoUrl?: string | null) {
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
  }

  const setConnection = (c: PryvConnection | null, serviceInfoUrl?: string | null) => {
    clearStack();
    storeActive(c, serviceInfoUrl);
    setActingAs(null);
    setConnectionState(c);
  };

  const actAs = (c: PryvConnection, who: ActingAs) => {
    // Nested hand-offs keep the first account to return to.
    let parentApi: string | null = null;
    let parentUsername = who.parentUsername;
    try {
      parentApi = localStorage.getItem(STORE_KEY_PARENT_API);
    } catch {
      parentApi = null;
    }
    if (parentApi == null || actingAs == null) {
      parentApi = connection?.apiEndpoint ?? null;
    } else {
      parentUsername = actingAs.parentUsername;
    }
    const next: ActingAs = { username: who.username, parentUsername };
    try {
      if (parentApi) localStorage.setItem(STORE_KEY_PARENT_API, parentApi);
      localStorage.setItem(STORE_KEY_ACTING, JSON.stringify(next));
    } catch {
      // In-memory only: "Back" then needs a new sign-in after a reload.
    }
    storeActive(c);
    setActingAs(next);
    setConnectionState(c);
  };

  const backToParent = () => {
    let parent: PryvConnection | null = null;
    try {
      parent = connectionFor(localStorage.getItem(STORE_KEY_PARENT_API));
    } catch {
      parent = null;
    }
    clearStack();
    storeActive(parent);
    setActingAs(null);
    setConnectionState(parent);
  };

  // Re-hydrate if another tab in the same origin updates the session.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY_API || e.key === STORE_KEY_SERVICE ||
          e.key === STORE_KEY_PARENT_API || e.key === STORE_KEY_ACTING) {
        setConnectionState(readStored());
        setActingAs(readActingAs());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <SessionContext.Provider value={{ connection, setConnection, actingAs, actAs, backToParent }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
