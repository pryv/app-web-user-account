// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
