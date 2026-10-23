// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [RGXI] Registering from an access request that carries an external id: the
 * page reads the id again from the poll (the query carries only the poll
 * URL) and sends it in the create-account body, so the new account is linked
 * at creation. The blinded value never reaches the URL, the history state or
 * browser storage, and is never rendered.
 */

const service = vi.hoisted(() => ({
  info: vi.fn(),
  flatHostings: vi.fn(),
  createUser: vi.fn(),
  login: vi.fn(),
}));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));

const flow = vi.hoisted(() => ({ loadAccessState: vi.fn() }));
vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Register from "./Register";
import { SessionProvider } from "../lib/session";

const POLL = "https://core.test/reg/access/k1";
const SI = "https://core.test/reg/service/info";
const REGISTER = "https://reg.core.test/";
const BLINDED = "blinded-7f3a9c-secret-value";
const ENTRY = `/register?poll=${encodeURIComponent(POLL)}&pryvServiceInfoUrl=${encodeURIComponent(SI)}`;

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  ({ status: 201, ok: true, json: async () => ({ username: "alice1", apiEndpoint: "https://alice1.core.test/", externalIdLinked: true }) }) as Response,
);

function Landed() {
  return <p data-testid="landed">landed</p>;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
}

describe("[RGXI] register with an external id on the access request", () => {
  beforeEach(() => {
    service.info.mockResolvedValue({ register: REGISTER });
    service.flatHostings.mockResolvedValue([{ key: "h1", available: true }]);
    service.createUser.mockResolvedValue({});
    service.login.mockResolvedValue({ endpoint: "https://alice1.core.test/", token: "t" });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("[RGXI1] the create-account body carries the external id read from the poll", async () => {
    flow.loadAccessState.mockResolvedValue({
      status: "NEED_SIGNIN",
      externalId: { namespace: "clinic-a", label: "Clinic A", blindedValue: BLINDED, mode: "hint" },
    });
    renderAt(ENTRY);
    await fillAndSubmit();
    await screen.findByTestId("landed");
    expect(flow.loadAccessState).toHaveBeenCalledWith(POLL);
    expect(service.createUser).not.toHaveBeenCalled();
    const posts = fetchMock.mock.calls.filter(([u]) => String(u) === REGISTER + "users");
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0][1]!.body as string);
    expect(body.externalId).toEqual({ namespace: "clinic-a", blindedValue: BLINDED, mode: "hint" });
    expect(body).toMatchObject({ username: "alice1", hosting: "h1" });
    expect(body.emailProof).toBeUndefined();
    // Never in a URL, browser storage or the page.
    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(BLINDED);
    expect(window.location.href).not.toContain(BLINDED);
    expect(JSON.stringify({ ...localStorage })).not.toContain(BLINDED);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(BLINDED);
    expect(document.body.innerHTML).not.toContain(BLINDED);
  });

  it("[RGXI2] (guard) a request without an external id registers as before", async () => {
    flow.loadAccessState.mockResolvedValue({ status: "NEED_SIGNIN" });
    renderAt(ENTRY);
    await fillAndSubmit();
    await screen.findByTestId("landed");
    expect(service.createUser).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/users"))).toHaveLength(0);
  });

  it("[RGXI3] (guard) without an access request the poll is not read", async () => {
    renderAt(`/register?pryvServiceInfoUrl=${encodeURIComponent(SI)}`);
    await fillAndSubmit();
    await screen.findByTestId("landed");
    expect(flow.loadAccessState).not.toHaveBeenCalled();
    expect(service.createUser).toHaveBeenCalledTimes(1);
  });
});
