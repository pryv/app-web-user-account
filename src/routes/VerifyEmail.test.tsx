// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [VEML] The landing page of the verification mail: the link pre-fills the
 * code and waits for a click (link scanners open links), and the "verified"
 * page offers no sign-in to someone already signed in to that account.
 */

const verify = vi.hoisted(() => ({ token: vi.fn(async () => "alice@example.com") }));
vi.mock("../lib/emailVerification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/emailVerification")>()),
  verifyEmailToken: verify.token,
}));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => ({ apiEndpointFor: async (u: string) => `https://${u}.core.test/` }),
}));

/** Tokens the core still accepts. */
const live = vi.hoisted(() => ({ tokens: new Set<string>() }));
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    // A stored session: the token is the URL's user part.
    Connection: class {
      apiEndpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
      }
      async accessInfo() {
        if (!live.tokens.has(new URL(this.apiEndpoint).username)) throw new Error("invalid-access-token");
        return { name: "session" };
      }
    },
  },
}));

import "../i18n";
import VerifyEmail from "./VerifyEmail";
import { SessionContext, type Session } from "../lib/useSession";
import { STORE_KEY_API, STORE_KEY_SERVICE, type PryvConnection } from "../lib/sessionStore";

/** A session held by this tab, for `apiEndpoint`, valid while its token is live. */
function held(apiEndpoint: string): PryvConnection {
  return {
    apiEndpoint,
    accessInfo: async () => {
      if (!live.tokens.has(new URL(apiEndpoint).username)) throw new Error("invalid-access-token");
      return {};
    },
  } as unknown as PryvConnection;
}

function page(connection: PryvConnection | null = null) {
  const session: Session = {
    connection,
    setConnection: () => {},
    actingAs: null,
    actAs: () => {},
    backToParent: () => {},
  };
  render(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={["/verify-email?username=alice&verifyToken=ABCDE"]}>
        <VerifyEmail />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

async function verifyNow() {
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(screen.getByText("Go to your account")).toBeTruthy());
  // Let the session check settle.
  await new Promise((r) => setTimeout(r, 20));
}

const signInShown = () => screen.queryByText("Sign in") != null;

describe("[VEML] VerifyEmail", () => {
  afterEach(() => {
    cleanup();
    verify.token.mockClear();
    live.tokens.clear();
    localStorage.clear();
  });

  it("[VEM1] the mailed link pre-fills the code and verifies nothing before the click", async () => {
    page();
    expect((screen.getByLabelText(/code/i) as HTMLInputElement).value).toBe("ABCDE");
    await new Promise((r) => setTimeout(r, 20));
    expect(verify.token).not.toHaveBeenCalled();
    await verifyNow();
    expect(verify.token).toHaveBeenCalledTimes(1);
  });

  it("[VEM2] not signed in: Sign in is offered", async () => {
    page();
    await verifyNow();
    expect(signInShown()).toBe(true);
  });

  it("[VEM3] signed in to this account, on this page or in another tab: no Sign in; another account or a dead session: Sign in", async () => {
    live.tokens.add("tok");
    live.tokens.add("bobtok");
    // This tab.
    page(held("https://tok@alice.core.test/"));
    await verifyNow();
    expect(signInShown()).toBe(false);
    cleanup();
    // Another tab stored it after this page loaded.
    localStorage.setItem(STORE_KEY_SERVICE, "https://reg.core.test/service/info");
    localStorage.setItem(STORE_KEY_API, "https://tok@alice.core.test/");
    page();
    await verifyNow();
    expect(signInShown()).toBe(false);
    cleanup();
    localStorage.clear();
    // Bob is signed in, the link verified Alice's address.
    page(held("https://bobtok@bob.core.test/"));
    await verifyNow();
    expect(signInShown()).toBe(true);
    cleanup();
    localStorage.setItem(STORE_KEY_SERVICE, "https://reg.core.test/service/info");
    localStorage.setItem(STORE_KEY_API, "https://bobtok@bob.core.test/");
    page();
    await verifyNow();
    expect(signInShown()).toBe(true);
    cleanup();
    // Alice's session, but its token no longer answers.
    live.tokens.delete("tok");
    page(held("https://tok@alice.core.test/"));
    await verifyNow();
    expect(signInShown()).toBe(true);
  });
});
