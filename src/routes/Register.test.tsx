// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [RGAR] Registering from an app's access request must lead back to the
 * consent screen with the request, not to the profile (or to the app while it
 * still waits for its access).
 */

const service = vi.hoisted(() => ({
  info: vi.fn(),
  createUser: vi.fn(),
  login: vi.fn(),
}));

vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Register from "./Register";
import { SessionProvider } from "../lib/session";

const POLL = "https://core.test/reg/access/k1";
const SI = "https://core.test/reg/service/info";
const ENTRY =
  `/register?poll=${encodeURIComponent(POLL)}&key=k1` +
  `&returnURL=${encodeURIComponent("https://app.test/cb")}&pryvServiceInfoUrl=${encodeURIComponent(SI)}`;

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.slice(path.indexOf("?")));
}

describe("[RGAR] register with a pending access request", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[RGAR1] the sign-in link goes to /auth with the request", async () => {
    service.info.mockResolvedValue({});
    renderAt(ENTRY);
    const href = (await screen.findByText(/Already have an account/)).closest("a")!.getAttribute("href")!;
    expect(href.startsWith("/auth?")).toBe(true);
    expect(queryOf(href).get("poll")).toBe(POLL);
  });

  it("[RGAR2] a successful registration returns to /auth, not to returnURL", async () => {
    service.info.mockResolvedValue({});
    service.createUser.mockResolvedValue({});
    service.login.mockResolvedValue({ endpoint: "https://alice.core.test/", token: "t" });
    renderAt(ENTRY);

    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);

    const where = (await screen.findByTestId("where")).textContent!;
    expect(where.startsWith("/auth?")).toBe(true);
    expect(queryOf(where).get("poll")).toBe(POLL);
  });
});
