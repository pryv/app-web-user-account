// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";

/**
 * [RGAX] The operator's registration acts and sign-in gate on the register
 * page: the acts render above Create and hold it until ready, are recorded
 * into the new account after sign-in without failing the registration, and
 * the gate page comes before the destination, which is resumed afterwards.
 */

const service = vi.hoisted(() => ({ info: vi.fn(), createUser: vi.fn(), login: vi.fn() }));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));
vi.mock("pryv", () => ({ default: { Service: class {} } }));

const acts = vi.hoisted(() => ({
  value: { element: null as unknown, ready: true, onRegistered: undefined as undefined | ((c: unknown) => Promise<void>) },
}));
vi.mock("../extensions/registerActs", () => ({ useRegisterActs: () => acts.value }));

const gate = vi.hoisted(() => ({ pendingAccountActs: vi.fn() }));
vi.mock("../extensions/signInGate", () => gate);

import Register from "./Register";
import { SessionProvider } from "../lib/session";
import { resumeAfterAccountActs } from "../lib/accountActsGate";

const POLL = "https://core.test/reg/access/k1";
const SI = "https://core.test/reg/service/info";
const ENTRY = `/register?poll=${encodeURIComponent(POLL)}&key=k1&pryvServiceInfoUrl=${encodeURIComponent(SI)}`;

function Where() {
  const { pathname, search, state } = useLocation();
  return (
    <>
      <p data-testid="where">{pathname + search}</p>
      <p data-testid="where-state">{JSON.stringify(state ?? null)}</p>
    </>
  );
}

function GatePage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => resumeAfterAccountActs(navigate)}>Done with the acts</button>;
}

function renderAt(entry = ENTRY) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/legal-acts" element={<GatePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
  fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
}

function okRegistration() {
  service.info.mockResolvedValue({});
  service.createUser.mockResolvedValue({});
  service.login.mockResolvedValue({ endpoint: "https://alice1.core.test/", token: "t" });
}

const createButton = () => screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;

describe("[RGAX] registration acts and sign-in gate", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    acts.value = { element: null, ready: true, onRegistered: undefined };
    gate.pendingAccountActs.mockReset();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("[RGX1] renders the acts above Create and keeps Create disabled until they are ready", async () => {
    okRegistration();
    acts.value = { element: <p>I consent to health data processing</p>, ready: false, onRegistered: undefined };
    renderAt();
    expect((await screen.findByTestId("register-acts")).textContent).toContain("I consent");
    await waitFor(() => expect(createButton().disabled).toBe(true));
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
    expect(service.createUser).not.toHaveBeenCalled();
  });

  it("[RGX2] records the acts with the new account's connection before moving on", async () => {
    okRegistration();
    gate.pendingAccountActs.mockResolvedValue(null);
    let release!: () => void;
    const onRegistered = vi.fn(() => new Promise<void>((r) => { release = r; }));
    acts.value = { element: null, ready: true, onRegistered };
    renderAt();
    await fillAndSubmit();
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
    expect((onRegistered.mock.calls[0] as unknown[])[0]).toMatchObject({ endpoint: "https://alice1.core.test/" });
    expect(screen.queryByTestId("where")).toBeNull();
    release();
    expect((await screen.findByTestId("where")).textContent!.startsWith("/auth?")).toBe(true);
  });

  it("[RGX3] a failure recording the acts does not fail the registration", async () => {
    okRegistration();
    gate.pendingAccountActs.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    acts.value = { element: null, ready: true, onRegistered: vi.fn().mockRejectedValue(new Error("write refused")) };
    renderAt();
    await fillAndSubmit();
    expect((await screen.findByTestId("where")).textContent!.startsWith("/auth?")).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toContain("registration acts");
    warn.mockRestore();
  });

  it("[RGX4] the gate page comes first, then the user resumes where the sign-in was going", async () => {
    okRegistration();
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    renderAt(`/register?pryvServiceInfoUrl=${encodeURIComponent(SI)}`);
    await fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Done with the acts" }));
    const where = (await screen.findByTestId("where")).textContent!;
    expect(where.startsWith("/account/profile")).toBe(true);
  });

  it("[RGX5] with an access request, /auth is reached directly (it runs the gate itself)", async () => {
    okRegistration();
    gate.pendingAccountActs.mockResolvedValue("/legal-acts");
    renderAt();
    await fillAndSubmit();
    const where = (await screen.findByTestId("where")).textContent!;
    expect(where.startsWith("/auth?")).toBe(true);
    expect(gate.pendingAccountActs).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("where-state").textContent!)).toEqual({ registeredAs: "alice1" });
  });
});
