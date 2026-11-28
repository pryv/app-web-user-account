// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [VEML] The landing page of the verification mail: the link pre-fills the
 * code and waits for a click (link scanners open links), and the "verified"
 * page offers no sign-in to someone already signed in.
 */

const verify = vi.hoisted(() => ({ token: vi.fn(async () => "alice@example.com") }));
vi.mock("../lib/emailVerification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/emailVerification")>()),
  verifyEmailToken: verify.token,
}));
vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => ({ apiEndpointFor: async (u: string) => `https://${u}.core.test/` }),
}));

import "../i18n";
import VerifyEmail from "./VerifyEmail";
import { SessionContext, type Session } from "../lib/useSession";
import { STORE_KEY_API, type PryvConnection } from "../lib/sessionStore";

function page(connection: PryvConnection | null = null) {
  const session: Session = {
    connection,
    setConnection: () => {},
    actingAs: null,
    actAs: () => {},
    backToParent: () => {},
  };
  render(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={["/verify-email?username=alice&verifyToken=ABCDE"]}>
        <VerifyEmail />
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

async function verifyNow() {
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(screen.getByText("Go to your account")).toBeTruthy());
}

describe("[VEML] VerifyEmail", () => {
  afterEach(() => {
    cleanup();
    verify.token.mockClear();
    localStorage.clear();
  });

  it("[VEM1] the mailed link pre-fills the code and verifies nothing before the click", async () => {
    page();
    expect((screen.getByLabelText(/code/i) as HTMLInputElement).value).toBe("ABCDE");
    await new Promise((r) => setTimeout(r, 20));
    expect(verify.token).not.toHaveBeenCalled();
    await verifyNow();
    expect(verify.token).toHaveBeenCalledTimes(1);
  });

  it("[VEM2] not signed in: Sign in is offered", async () => {
    page();
    await verifyNow();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("[VEM3] signed in on this page, or in another tab: no Sign in", async () => {
    page({ apiEndpoint: "https://tok@alice.core.test/" } as unknown as PryvConnection);
    await verifyNow();
    expect(screen.queryByText("Sign in")).toBeNull();
    cleanup();
    localStorage.setItem(STORE_KEY_API, "https://tok@alice.core.test/");
    page();
    await verifyNow();
    expect(screen.queryByText("Sign in")).toBeNull();
  });
});
