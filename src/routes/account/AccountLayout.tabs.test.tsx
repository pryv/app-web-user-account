// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * [ALTB] The account nav is built from the tabs registry, in its order,
 * with the current query string carried on every link.
 *
 * [ALNV] It reads the tabs through `useAccountTabs()`: a fork returning a
 * subset hides the others; the active link is marked `aria-current`.
 */

const tabs = vi.hoisted(() => {
  const all = [
    { path: "first", label: "First tab", element: null },
    { path: "second", label: "Second tab", element: null },
    { path: "third", label: "Third tab", element: null },
  ];
  return { all, shown: all };
});

vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: { api: vi.fn() }, setConnection: vi.fn() }),
}));
vi.mock("../../lib/sessionPaths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sessionPaths")>()),
  signinPath: () => "/signin",
}));
vi.mock("../../accountTabs", () => ({
  get ACCOUNT_TABS() {
    return tabs.all;
  },
  useAccountTabs: () => tabs.shown,
  EXTRA_ROUTES: [],
}));

import AccountLayout from "./AccountLayout";

afterEach(() => {
  cleanup();
  tabs.shown = tabs.all;
});

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/account" element={<AccountLayout />}>
          <Route path="second" element={<p>second page</p>} />
          <Route path="third" element={<p>third page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return within(screen.getByRole("navigation", { name: "Account sections" })).getAllByRole("link");
}

describe("[ALTB] account nav from the registry", () => {
  it("[ALT1] renders one link per registered tab, in order, keeping the query", () => {
    const links = renderAt("/account/second?pryvServiceInfoUrl=x");
    expect(links.map((l) => l.textContent)).toEqual(["First tab", "Second tab", "Third tab"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/account/first?pryvServiceInfoUrl=x",
      "/account/second?pryvServiceInfoUrl=x",
      "/account/third?pryvServiceInfoUrl=x",
    ]);
    expect(links[1].className).toContain("border-primary");
    expect(links[0].className).toContain("border-transparent");
  });
});

describe("[ALNV] account nav through useAccountTabs", () => {
  it("[ALN1] the active tab carries aria-current, the others do not", () => {
    const links = renderAt("/account/third?backUrl=https%3A%2F%2Fapp.test");
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, null, "page"]);
    expect(links.every((l) => l.getAttribute("href")?.endsWith("?backUrl=https%3A%2F%2Fapp.test"))).toBe(true);
  });

  it("[ALN2] a subset returned by useAccountTabs hides the other tabs", () => {
    tabs.shown = [tabs.all[2], tabs.all[0]];
    const links = renderAt("/account/third");
    expect(links.map((l) => l.textContent)).toEqual(["Third tab", "First tab"]);
    expect(screen.queryByText("Second tab")).toBeNull();
  });

  it("[ALN3] the page renders beside the nav, in the content column", () => {
    renderAt("/account/second");
    expect(within(screen.getByTestId("account-content")).getByText("second page")).toBeTruthy();
  });
});
