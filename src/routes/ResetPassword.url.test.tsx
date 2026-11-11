// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * [RSPU] /reset-password URL hygiene:
 * - the one-time resetToken leaves the URL once read, and the page still uses it;
 * - `?username=` pre-fills the username field, as on /signin.
 */

const service = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(async () => undefined),
  resetPassword: vi.fn(async () => undefined),
}));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
  resolveUserId: async (_s: unknown, username: string) => username,
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import ResetPassword from "./ResetPassword";

let current = "";
function LocationProbe() {
  current = useLocation().search;
  return null;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/reset-password"
          element={
            <>
              <ResetPassword />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const APP = "https://app.example.test/";

describe("[RSPU] reset password: URL hygiene", () => {
  beforeEach(() => {
    service.requestPasswordReset.mockClear();
    service.resetPassword.mockClear();
    current = "";
  });
  afterEach(() => cleanup());

  it("[RSPU1] the token leaves the URL, the other params stay, and the reset still uses it", async () => {
    const { container } = renderAt(`/reset-password?resetToken=tok123&backUrl=${encodeURIComponent(APP)}&lang=fr`);
    await waitFor(() => expect(current).not.toContain("resetToken"));
    const kept = new URLSearchParams(current);
    expect(kept.get("backUrl")).toBe(APP);
    expect(kept.get("lang")).toBe("fr");
    expect(container.querySelector("#newPassword")).not.toBeNull();

    fireEvent.change(container.querySelector("#username")!, { target: { value: "alice" } });
    fireEvent.change(container.querySelector("#newPassword")!, { target: { value: "n3w-passw0rd" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(service.resetPassword).toHaveBeenCalled());
    expect(service.resetPassword).toHaveBeenCalledWith("alice", "n3w-passw0rd", "tok123", expect.anything());
  });

  it("[RSPU2] no token: the URL is left as is", async () => {
    renderAt("/reset-password?backLabel=Example");
    await new Promise((r) => setTimeout(r, 0));
    expect(current).toBe("?backLabel=Example");
  });

  it("[RSPU3] ?username= pre-fills the field, which stays editable", () => {
    const { container } = renderAt("/reset-password?username=%20bob%20");
    const field = container.querySelector<HTMLInputElement>("#username")!;
    expect(field.value).toBe("bob");
    fireEvent.change(field, { target: { value: "carol" } });
    expect(field.value).toBe("carol");
  });

  it("[RSPU4] the hint reaches the request", async () => {
    renderAt("/reset-password?username=bob");
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/ }));
    await waitFor(() => expect(service.requestPasswordReset).toHaveBeenCalled());
    expect((service.requestPasswordReset.mock.calls[0] as unknown[])[0]).toBe("bob");
  });

  it("[RSPU5] no hint: the field starts empty", () => {
    const { container } = renderAt("/reset-password");
    expect(container.querySelector<HTMLInputElement>("#username")!.value).toBe("");
  });
});
