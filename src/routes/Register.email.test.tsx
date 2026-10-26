// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [RGEM] The operator's registration email slot (`registerEmailPolicy`): the
 * shipped stub keeps the email optional (a blank one becomes a random
 * placeholder address); `prefill` is the field's initial value; `required`
 * marks the field required, refuses a blank submit and never generates the
 * placeholder.
 */

const service = vi.hoisted(() => ({ info: vi.fn(), createUser: vi.fn(), login: vi.fn() }));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));
vi.mock("pryv", () => ({ default: { Service: class {} } }));

const slot = vi.hoisted(() => ({ registerEmailPolicy: vi.fn() }));
vi.mock("../extensions/registerEmail", () => slot);

import Register from "./Register";
import { SessionProvider } from "../lib/session";

const SI = "https://core.test/reg/service/info";
const ENTRY = `/register?pryvServiceInfoUrl=${encodeURIComponent(SI)}&invite=i1`;

function renderAt(entry = ENTRY) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<p data-testid="where">left</p>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(email?: string) {
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
  if (email != null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
  // Submits without the browser's field validation, as a script could.
  fireEvent.submit(screen.getByLabelText("Username").closest("form")!);
}

function sentEmail(): string {
  return (service.createUser.mock.calls[0][0] as { email: string }).email;
}

function mockServiceOk() {
  service.info.mockResolvedValue({});
  service.createUser.mockResolvedValue({});
  service.login.mockResolvedValue({ endpoint: "https://alice1.core.test/", token: "t" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("[RGEM] registration email slot", () => {
  it("[RGEM1] the shipped stub prefills nothing and requires nothing", async () => {
    const actual = await vi.importActual<typeof import("../extensions/registerEmail")>("../extensions/registerEmail");
    expect(actual.registerEmailPolicy("?invite=i1")).toEqual({ prefill: null, required: false });
  });

  it("[RGEM2] default behaviour: a blank email is optional and becomes a random placeholder", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: null, required: false });
    mockServiceOk();
    renderAt();
    const field = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.required).toBe(false);
    expect(screen.getByText("Optional, but required to reset your password.")).toBeTruthy();

    await fillAndSubmit();
    await screen.findByTestId("where");
    expect(sentEmail()).toMatch(/^[a-z0-9]{20}@pryv\.io$/);
  });

  it("[RGEM3] prefill is the field's initial value, read from the page's query, and is sent", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: "alice@example.com", required: false });
    mockServiceOk();
    renderAt();
    expect(((await screen.findByLabelText("Email")) as HTMLInputElement).value).toBe("alice@example.com");
    expect(slot.registerEmailPolicy).toHaveBeenCalledWith(`?pryvServiceInfoUrl=${encodeURIComponent(SI)}&invite=i1`);

    await fillAndSubmit();
    await screen.findByTestId("where");
    expect(sentEmail()).toBe("alice@example.com");
  });

  it("[RGEM4] required: the field is required, a blank submit is refused, no placeholder is generated", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: null, required: true });
    mockServiceOk();
    renderAt();
    const field = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(field.required).toBe(true);
    expect(field.checkValidity()).toBe(false);
    expect(screen.getByText("Required. Also used to reset your password.")).toBeTruthy();

    await fillAndSubmit();
    expect(await screen.findByText("Please enter your email to create your account.")).toBeTruthy();
    expect(service.createUser).not.toHaveBeenCalled();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("[RGEM6] a policy that throws is logged and the email stays optional", async () => {
    slot.registerEmailPolicy.mockImplementation(() => {
      throw new Error("bad invitation");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockServiceOk();
    renderAt();
    const field = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.required).toBe(false);
    expect(warn).toHaveBeenCalled();

    await fillAndSubmit();
    await screen.findByTestId("where");
    expect(sentEmail()).toMatch(/^[a-z0-9]{20}@pryv\.io$/);
    warn.mockRestore();
  });

  it("[RGEM7] an odd answer is coerced: a prefill that is not a string is empty, only true requires", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: 42, required: "yes" });
    renderAt();
    const field = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.required).toBe(false);
  });

  it("[RGEM8] the email is sent trimmed", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: " alice@example.com ", required: true });
    mockServiceOk();
    renderAt();
    await fillAndSubmit();
    await screen.findByTestId("where");
    expect(sentEmail()).toBe("alice@example.com");
  });

  it("[RGEM5] required with an email given: the account is created with it", async () => {
    slot.registerEmailPolicy.mockReturnValue({ prefill: null, required: true });
    mockServiceOk();
    renderAt();
    await fillAndSubmit("bob@example.com");
    await screen.findByTestId("where");
    expect(sentEmail()).toBe("bob@example.com");
  });
});
