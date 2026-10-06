// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import SignIn from "./SignIn";
import Register from "./Register";
import { SessionProvider } from "../lib/session";

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/register" element={<Register />} />
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
