import { useEffect, useState, type ReactNode } from "react";
import { getDefaultServiceInfoUrl } from "./deployedSettings";
import {
  STORE_KEY_API,
  STORE_KEY_SERVICE,
  STORE_KEY_PARENT_API,
  STORE_KEY_ACTING,
  connectionFor,
  readStored,
  readActingAs,
  clearStack,
  type ActingAs,
  type PryvConnection,
} from "./sessionStore";
import { SessionContext } from "./useSession";

// The session's types stay importable from here (extensions import
// `PryvConnection` from this module); the reads live in ./sessionStore, the
// paths in ./sessionPaths, the hook in ./useSession.
export type { ActingAs, PryvConnection } from "./sessionStore";

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
    // Persist the resolved platform (param, else the deployment default) so a
    // session opened without the param survives a reload, and the
    // platform-match checks on storedServiceInfoUrl() have a value.
    storeActive(c, serviceInfoUrl ?? getDefaultServiceInfoUrl());
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

