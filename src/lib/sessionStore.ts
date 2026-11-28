import { Pryv } from "./pryvClient";
import { getDefaultServiceInfoUrl } from "./deployedSettings";

/*
 * The persisted session: its shape, where it is kept in localStorage, and the
 * reads the pages and the session provider share (lib/session.tsx).
 */

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

export const STORE_KEY_API = "pryv.session.apiEndpoint";
export const STORE_KEY_SERVICE = "pryv.session.serviceInfoUrl";
export const STORE_KEY_PARENT_API = "pryv.session.parent.apiEndpoint";
export const STORE_KEY_ACTING = "pryv.session.actingAs";

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

export function connectionFor(apiEndpoint: string | null): PryvConnection | null {
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

export function readStored(): PryvConnection | null {
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

/**
 * Tokens of the sessions this app keeps in this browser (the signed-in one
 * and, while acting for another account, the parent one). A page that opens a
 * personal session of its own checks this before ending it: a sign-in may hand
 * back a session the app is already using.
 */
export function storedSessionTokens(): string[] {
  const tokens: string[] = [];
  for (const key of [STORE_KEY_API, STORE_KEY_PARENT_API]) {
    try {
      const api = localStorage.getItem(key);
      if (!api) continue;
      const token = decodeURIComponent(new URL(api).username);
      if (token) tokens.push(token);
    } catch {
      // Unreadable entry: nothing to compare against.
    }
  }
  return tokens;
}

export function readActingAs(): ActingAs | null {
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

export function clearStack(): void {
  try {
    localStorage.removeItem(STORE_KEY_PARENT_API);
    localStorage.removeItem(STORE_KEY_ACTING);
  } catch {
    // localStorage unavailable: nothing was stored.
  }
}

