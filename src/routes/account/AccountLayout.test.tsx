// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [ALRT] A signed-out deep link into the account section bounces to sign-in
 * with the page it asked for, and the entry link's params, kept.
 */

vi.mock("pryv", () => ({ default: { Service: class {}, Connection: class {} } }));

import AccountLayout from "./AccountLayout";
import { SessionProvider } from "../../lib/session";

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

describe("[ALRT] account guard", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("[ALRT1] sends a signed-out visitor to /signin with returnTo and the back link", async () => {
    render(
      <MemoryRouter initialEntries={["/account/security?backLabel=App&backUrl=https%3A%2F%2Fapp.test"]}>
        <SessionProvider>
          <Routes>
            <Route path="/account" element={<AccountLayout />}>
              <Route path="security" element={<p>security</p>} />
            </Route>
            <Route path="/signin" element={<Where />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
    );
    const where = (await screen.findByTestId("where")).textContent!;
    const q = new URLSearchParams(where.slice(where.indexOf("?")));
    expect(where.startsWith("/signin?")).toBe(true);
    expect(q.get("returnTo")).toBe("/account/security?backLabel=App&backUrl=https%3A%2F%2Fapp.test");
    expect(q.get("backLabel")).toBe("App");
    expect(q.get("backUrl")).toBe("https://app.test");
  });
});
