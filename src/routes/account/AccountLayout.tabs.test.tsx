// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [ALTB] The account nav is built from the tabs registry, in its order,
 * with the current query string carried on every link.
 */

vi.mock("../../lib/session", () => ({
  useSession: () => ({ connection: { api: vi.fn() }, setConnection: vi.fn() }),
  signinPath: () => "/signin",
}));
vi.mock("../../accountTabs", () => ({
  ACCOUNT_TABS: [
    { path: "first", label: "First tab", element: <p>first page</p> },
    { path: "second", label: "Second tab", element: <p>second page</p> },
  ],
  EXTRA_ROUTES: [],
}));

import AccountLayout from "./AccountLayout";

afterEach(() => cleanup());

describe("[ALTB] account nav from the registry", () => {
  it("[ALT1] renders one link per registered tab, in order, keeping the query", () => {
    render(
      <MemoryRouter initialEntries={["/account/second?pryvServiceInfoUrl=x"]}>
        <Routes>
          <Route path="/account" element={<AccountLayout />}>
            <Route path="second" element={<p>second page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "Account sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["First tab", "Second tab"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/account/first?pryvServiceInfoUrl=x",
      "/account/second?pryvServiceInfoUrl=x",
    ]);
    expect(links[1].className).toContain("border-primary");
    expect(links[0].className).toContain("border-transparent");
  });
});
