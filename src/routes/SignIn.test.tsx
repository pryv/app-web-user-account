// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [SIUH] `?username=` is a sign-in hint: it pre-fills the sign-in field and
 * never replaces what the user typed. Registration ignores it.
 */

const service = vi.hoisted(() => ({
  info: vi.fn(),
  apiEndpointFor: vi.fn(),
  login: vi.fn(),
}));

vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    // A stored session ("Continue as"): the account is the api host's first label.
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      token: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        const url = new URL(apiEndpoint);
        this.token = url.username;
        url.username = "";
        this.endpoint = url.toString();
      }
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
    },
  },
}));

const gate = vi.hoisted(() => ({ pendingAccountActs: vi.fn(async (): Promise<string | null> => null) }));
vi.mock("../extensions/signInGate", () => gate);

// Continuing after the sign-in is the real one unless a test makes it fail.
const continuing = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock("../lib/accountActsGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/accountActsGate")>();
  return {
    ...actual,
    continueSignedIn: async (...args: Parameters<typeof actual.continueSignedIn>) => {
      if (continuing.failWith) throw continuing.failWith;
      return actual.continueSignedIn(...args);
    },
  };
});

import SignIn from "./SignIn";
import Register from "./Register";
import { SessionProvider } from "../lib/session";

function AccountProbe() {
  const { pathname } = useLocation();
  return <p data-testid="account-page">{pathname}</p>;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/register" element={<Register />} />
          <Route path="/account/*" element={<AccountProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[SIUH] username sign-in hint", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[SIUH2] pre-fills the sign-in field from ?username=", async () => {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin?username=alice");
    const field = (await screen.findByLabelText("Username or email")) as HTMLInputElement;
    expect(field.value).toBe("alice");
  });

  it("[SIUH3] typed input replaces the hint", async () => {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin?username=alice");
    const field = (await screen.findByLabelText("Username or email")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "bob@example.test" } });
    expect(field.value).toBe("bob@example.test");
  });

  it("[SIUH4] the sign-in field is empty without a hint", async () => {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin");
    const field = (await screen.findByLabelText("Username or email")) as HTMLInputElement;
    expect(field.value).toBe("");
  });

  it("[SIUH5] registration does not pre-fill from ?username=", async () => {
    service.info.mockResolvedValue({});
    renderAt("/register?username=alice");
    const field = (await screen.findByLabelText("Username")) as HTMLInputElement;
    expect(field.value).toBe("");
  });
});

describe("[SIST] sign-in subtitle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[SIST1] names no app when none is asking", async () => {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin");
    expect(await screen.findByText("Sign in to your account.")).toBeTruthy();
    expect(screen.queryByText(/requesting app/)).toBeNull();
  });

  it("[SIST2] names the requesting app while an access request is pending", async () => {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin?poll=" + encodeURIComponent("https://core.example.com/reg/access/abc"));
    expect(await screen.findByText("Sign in to grant access to the requesting app.")).toBeTruthy();
    expect(screen.queryByText("Sign in to your account.")).toBeNull();
  });
});

describe("[SISP] third-party sign-in probe", () => {
  /** A fresh fetch stub per test, answering an empty provider list. */
  function stubFetch() {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ providers: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("[SISP1] a platform with the username in the api host is not probed (no placeholder-host lookup)", async () => {
    const fetchMock = stubFetch();
    service.info.mockResolvedValue({ api: "https://{username}.api.example.com/" });
    service.apiEndpointFor.mockResolvedValue("https://_.api.example.com/");
    renderAt("/signin");
    await screen.findByLabelText("Username or email");
    // The probe effect has started (it reads the template, or a probe without
    // the check goes straight to the placeholder endpoint).
    await waitFor(() =>
      expect(service.info.mock.calls.length + service.apiEndpointFor.mock.calls.length).toBeGreaterThan(0),
    );
    // Let the probe effect run to completion.
    await new Promise((r) => setTimeout(r, 0));
    expect(service.apiEndpointFor).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/auth/sso/providers"))).toBe(false);
  });

  it("[SISP2] a dnsLess platform is still probed, on its core origin", async () => {
    const fetchMock = stubFetch();
    service.info.mockResolvedValue({ api: "https://core.example.com/{username}/" });
    service.apiEndpointFor.mockResolvedValue("https://core.example.com/_/");
    renderAt("/signin");
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("https://core.example.com/auth/sso/providers"),
    );
  });
});

/**
 * [SICN] After a completed sign-in the page stays on the busy form until it
 * leaves: the "Welcome back" card is for a session found on arrival, and the
 * fallback when continuing fails.
 */
describe("[SICN] continuing after a sign-in", () => {
  const SIGNED_IN = {
    apiEndpoint: "https://tok@alice.core.test/",
    endpoint: "https://alice.core.test/",
    token: "tok",
    username: async () => "alice",
  };

  async function signIn() {
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    service.login.mockResolvedValue(SIGNED_IN);
    renderAt("/signin");
    fireEvent.change(await screen.findByLabelText("Username or email"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    gate.pendingAccountActs.mockImplementation(async () => null);
    continuing.failWith = null;
    localStorage.clear();
  });

  it("[SICN1] the signed-in card never shows while the gate holds the sign-in", async () => {
    let release: (path: string | null) => void = () => {};
    gate.pendingAccountActs.mockImplementation(
      () => new Promise<string | null>((resolve) => (release = resolve)),
    );
    await signIn();
    await waitFor(() => expect(gate.pendingAccountActs).toHaveBeenCalled());
    // Let the re-render with the new session settle while the gate is pending.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(screen.getByRole("button", { name: "Signing in…" })).toHaveProperty("disabled", true);

    release(null);
    expect((await screen.findByTestId("account-page")).textContent).toBe("/account/profile");
    expect(screen.queryByText("Welcome back")).toBeNull();
  });

  it("[SICN2] the signed-in card is the fallback when continuing fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    continuing.failWith = new Error("cannot continue");
    await signIn();
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    // The card renders before the username resolves: wait for the named button.
    expect(await screen.findByRole("button", { name: "Continue as alice" })).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("[SICN3] \"Continue as\" with a stored session still continues", async () => {
    localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
    localStorage.setItem("pryv.session.apiEndpoint", "https://bob-tok@bob.core.test/");
    service.apiEndpointFor.mockRejectedValue(new Error("no service info"));
    renderAt("/signin");
    fireEvent.click(await screen.findByRole("button", { name: "Continue as bob" }));
    expect((await screen.findByTestId("account-page")).textContent).toBe("/account/profile");
    expect(gate.pendingAccountActs).toHaveBeenCalledTimes(1);
  });
});
