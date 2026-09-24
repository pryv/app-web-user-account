// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [RGTA] The Terms checkbox is shown, and required, only when the deployment
 * links to a Terms or Privacy document. With none, the form is unchanged.
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
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";

const TERMS = "https://legal.example.test/terms";
const PRIVACY = "https://legal.example.test/privacy";
const SI_TERMS = "https://reg.example.test/terms.html";

function renderRegister() {
  render(
    <MemoryRouter initialEntries={["/register"]}>
      <SessionProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function submitButton(): Promise<HTMLButtonElement> {
  const button = (await screen.findByRole("button", { name: "Create account" })) as HTMLButtonElement;
  // Wait for the service-info to answer (the button is disabled until then).
  await waitFor(() => expect(service.info).toHaveBeenCalled());
  return button;
}

describe("[RGTA] terms acceptance at registration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    _setDeployedSettingsForTest(null);
  });

  it("[RGT1] no Terms or Privacy URL: no checkbox, submit enabled as before", async () => {
    service.info.mockResolvedValue({});
    renderRegister();
    const button = await submitButton();
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(document.getElementById("acceptTerms")).toBeNull();
    expect(screen.queryByText(/Terms of use/)).toBeNull();
  });

  it("[RGT2] settings terms + privacy: submit disabled until ticked, links open in a new tab", async () => {
    service.info.mockResolvedValue({ terms: SI_TERMS });
    _setDeployedSettingsForTest({ legal: { terms: { en: TERMS, fr: TERMS + "-fr" }, privacy: PRIVACY } });
    renderRegister();
    const button = await submitButton();
    const box = (await screen.findByRole("checkbox")) as HTMLInputElement;
    expect(box.id).toBe("acceptTerms");
    expect(box.checked).toBe(false);
    expect(box.required).toBe(true);
    // Give the service-info time to answer: the tick is the only thing left.
    await waitFor(() => expect(service.info).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(button.disabled).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(box);
    expect(button.disabled).toBe(true);

    const terms = screen.getByRole("link", { name: "Terms of use" });
    const privacy = screen.getByRole("link", { name: "Privacy policy" });
    // settings.json wins over the service-info terms.
    expect(terms.getAttribute("href")).toBe(TERMS);
    expect(privacy.getAttribute("href")).toBe(PRIVACY);
    for (const a of [terms, privacy]) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noreferrer");
    }
  });

  it("[RGT3] only the service-info terms: checkbox with the Terms link only", async () => {
    service.info.mockResolvedValue({ terms: SI_TERMS });
    renderRegister();
    await submitButton();
    await screen.findByRole("checkbox");
    expect(screen.getByRole("link", { name: "Terms of use" }).getAttribute("href")).toBe(SI_TERMS);
    expect(screen.queryByRole("link", { name: "Privacy policy" })).toBeNull();
    expect(screen.queryByText(/Privacy/)).toBeNull();
  });

  it("[RGT4] a javascript: URL in settings is ignored", async () => {
    service.info.mockResolvedValue({ terms: "javascript:alert(1)" });
    _setDeployedSettingsForTest({ legal: { terms: "javascript:alert(1)", privacy: { en: "javascript:alert(2)" } } });
    renderRegister();
    const button = await submitButton();
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(document.getElementById("acceptTerms")).toBeNull();
    expect(screen.queryAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("javascript:"))).toBe(false);
  });
});
