// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [BRNC] Copy naming the product comes from `brand.tsx`, so replacing that
 * file rebrands the pages.
 */

const service = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: () => service,
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

vi.mock("../brand", () => ({
  brand: { productName: "Acme", accountNoun: "Acme health account" },
  Logo: () => null,
}));

import Register from "./Register";
import { SessionProvider } from "../lib/session";

describe("[BRNC] brand copy", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("[BRN1] the register subtitle names the brand's account noun", async () => {
    service.info.mockResolvedValue({});
    render(
      <MemoryRouter initialEntries={["/register"]}>
        <SessionProvider>
          <Register />
        </SessionProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Register a new Acme health account.")).toBeTruthy();
    expect(screen.queryByText(/Pryv account/)).toBeNull();
  });
});
