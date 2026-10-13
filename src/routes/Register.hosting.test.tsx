// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [RGHS] The hosting choice on the register page: with several hostings none is
 * pre-selected and Create waits for one (the hosting decides where the data is
 * stored, so a default cannot stand for the user's choice); a single hosting is
 * selected for the user. The acts hook is told the chosen hosting.
 */

const service = vi.hoisted(() => ({ info: vi.fn(), createUser: vi.fn(), login: vi.fn(), flatHostings: vi.fn() }));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));
vi.mock("pryv", () => ({ default: { Service: class {} } }));

const actsInputs = vi.hoisted(() => [] as unknown[]);
vi.mock("../extensions/registerActs", () => ({
  useRegisterActs: (input: unknown) => {
    actsInputs.push(input);
    return { element: null, ready: true };
  },
}));
vi.mock("../extensions/signInGate", () => ({ pendingAccountActs: vi.fn().mockResolvedValue(null) }));

import Register from "./Register";
import { SessionProvider } from "../lib/session";

const SI = "https://core.test/reg/service/info";
const ENTRY = `/register?pryvServiceInfoUrl=${encodeURIComponent(SI)}`;
const EU = { key: "eu", name: "Europe", available: true };
const US = { key: "us", name: "United States", available: true };

function renderAt() {
  render(
    <MemoryRouter initialEntries={[ENTRY]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fill() {
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
}

const createButton = () => screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;
const lastActsInput = () => actsInputs[actsInputs.length - 1] as { hosting: unknown };

describe("[RGHS] register hosting choice", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    actsInputs.length = 0;
    sessionStorage.clear();
    localStorage.clear();
  });

  function setup(hostings: unknown[]) {
    service.info.mockResolvedValue({});
    service.flatHostings.mockResolvedValue(hostings);
    service.createUser.mockResolvedValue({});
    service.login.mockResolvedValue({ endpoint: "https://alice1.core.test/", token: "t" });
  }

  it("[RGHS1] with several hostings, none is selected and Create waits for a choice", async () => {
    setup([EU, US]);
    renderAt();
    await fill();
    const select = (await screen.findByLabelText("Hosting")) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Choose where your data is hosted" })).toBeTruthy();
    await waitFor(() => expect(createButton().disabled).toBe(true));
    expect(lastActsInput()).toEqual({ hosting: null });
    fireEvent.submit(select.closest("form")!);
    expect(await screen.findByText("Please choose a hosting to create your account.")).toBeTruthy();
    expect(service.createUser).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "us" } });
    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(lastActsInput()).toEqual({ hosting: US });
    fireEvent.submit(select.closest("form")!);
    await waitFor(() => expect(service.createUser).toHaveBeenCalledTimes(1));
    expect(service.createUser.mock.calls[0][0]).toMatchObject({ hosting: "us" });
  });

  it("[RGHS2] a single hosting is selected for the user and passed to the acts", async () => {
    setup([EU]);
    renderAt();
    await fill();
    const select = (await screen.findByLabelText("Hosting")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("eu"));
    expect(lastActsInput()).toEqual({ hosting: EU });
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.submit(select.closest("form")!);
    await waitFor(() => expect(service.createUser).toHaveBeenCalledTimes(1));
    expect(service.createUser.mock.calls[0][0]).toMatchObject({ hosting: "eu" });
  });

  it("[RGHS3] while the hosting list loads, Create waits (a submit would send `auto`)", async () => {
    setup([]);
    let release!: (list: unknown[]) => void;
    service.flatHostings.mockReturnValue(new Promise((r) => { release = r; }));
    renderAt();
    await fill();
    await waitFor(() => expect(service.info).toHaveBeenCalled());
    await waitFor(() => expect(createButton().disabled).toBe(true));
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
    expect(service.createUser).not.toHaveBeenCalled();
    release([EU]);
    await waitFor(() => expect(createButton().disabled).toBe(false));
  });
});
