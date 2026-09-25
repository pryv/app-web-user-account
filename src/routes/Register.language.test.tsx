// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [RGLG] The account is created in the UI language (its base code), not in a
 * hard-coded English.
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
import i18n from "../i18n";

describe("[RGLG] register language", () => {
  const original = i18n.language;
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    i18n.language = original;
  });

  it("[RGLG1] the create-account call carries the current language's base code", async () => {
    // Set directly: the build ships English only, so changeLanguage() cannot
    // select another code, and a regional variant exercises the reduction.
    i18n.language = "de-CH";
    service.info.mockResolvedValue({});
    service.createUser.mockResolvedValue({});
    service.login.mockRejectedValue(new Error("no auto sign-in"));
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <SessionProvider>
          <Register />
        </SessionProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-pass-1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "secret-pass-1" } });
    await waitFor(() => expect(service.info).toHaveBeenCalled());
    fireEvent.submit(screen.getByLabelText("Username").closest("form")!);

    await waitFor(() => expect(service.createUser).toHaveBeenCalledTimes(1));
    expect(service.createUser.mock.calls[0][0].language).toBe("de");
  });
});
