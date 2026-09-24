import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Pryv from "pryv";
import { getDefaultServiceInfoUrl } from "./deployedSettings";

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
 * param. Last, the deployment's default platform from settings.json.
 */
export function signinPath(searchOrUndefined?: string, returnTo?: string | null): string {
  let serviceInfoUrl: string | null = null;
  const sp = new URLSearchParams(searchOrUndefined ?? "");
  serviceInfoUrl = sp.get("pryvServiceInfoUrl");
  if (!serviceInfoUrl) {
    try {
      serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE);
    } catch {
      serviceInfoUrl = null;
    }
  }
  serviceInfoUrl ??= getDefaultServiceInfoUrl();
  const out = new URLSearchParams();
  if (serviceInfoUrl) out.set("pryvServiceInfoUrl", serviceInfoUrl);
  carryHandoffParams(sp, out);
  // A fresh target wins; otherwise keep the one already on a re-bounce.
  const target = safeReturnTo(returnTo) ?? safeReturnTo(sp.get("returnTo"));
  if (target) out.set("returnTo", target);
  const query = out.toString();
  return query ? "/signin?" + query : "/signin";
}

/**
 * Query params an embedding app sets on any entry link, kept across the
 * sign-in bounce: a sign-in pre-fill and the "go back" affordance.
 */
export const HANDOFF_PARAMS = ["username", "backUrl", "backLabel"] as const;

function carryHandoffParams(from: URLSearchParams, to: URLSearchParams): void {
  for (const key of HANDOFF_PARAMS) {
    const value = from.get(key);
    if (value) to.set(key, value);
  }
}

/** The pages a signed-out visitor is bounced from and may be returned to. */
const RETURN_TO_PREFIXES = ["/account/", "/change-password"] as const;

/**
 * `raw` as a same-origin path to return to after sign-in, or null.
 *
 * Query-supplied, so it is validated like a redirect target: root-relative
 * only (no scheme, no `//` or `/\` authority), and limited to the account
 * pages whose guards set it. Those pages carry nothing secret in their query,
 * which is what lets `returnTo` ride through a third-party sign-in; approval
 * hand-offs, whose query holds a bearer link, keep using `next` instead.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://origin.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://origin.invalid") return null;
  const path = url.pathname;
  const allowed = RETURN_TO_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
  if (!allowed) return null;
  // Never nested: a returnTo inside the target could resurrect a stale page.
  url.searchParams.delete("returnTo");
  return path + url.search + url.hash;
}

/** `path` with `pryvServiceInfoUrl` and the hand-off params carried over. */
export function accountPath(path: string, search: string | undefined, serviceInfoUrl: string | null): string {
  const from = new URLSearchParams(search ?? "");
  const out = new URLSearchParams();
  if (serviceInfoUrl) out.set("pryvServiceInfoUrl", serviceInfoUrl);
  carryHandoffParams(from, out);
  const query = out.toString();
  return query ? path + "?" + query : path;
}

/**
 * Service-info URL of the persisted session (platform-match checks). Same rule
 * as restoring the session: a stored session with no stored platform is on the
 * deployment's own platform.
 */
export function storedServiceInfoUrl(): string | null {
  try {
    const stored = localStorage.getItem(STORE_KEY_SERVICE);
    if (stored) return stored;
    return localStorage.getItem(STORE_KEY_API) ? getDefaultServiceInfoUrl() : null;
  } catch {
    return null;
  }
}

function connectionFor(apiEndpoint: string | null): PryvConnection | null {
  try {
    // A session created without the param stored nothing here: use the
    // deployment's own platform rather than dropping the session.
    const serviceInfoUrl = localStorage.getItem(STORE_KEY_SERVICE) ?? getDefaultServiceInfoUrl();
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

/**
 * While the session acts for a controlled account: the session of the account
 * acting (kept to return to), or null. Pages that grant access for someone
 * (the auth popup) start from it rather than from the acting session.
 */
export function storedParentConnection(): PryvConnection | null {
  if (readActingAs() == null) return null;
  try {
    return connectionFor(localStorage.getItem(STORE_KEY_PARENT_API));
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

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
