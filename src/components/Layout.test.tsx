// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [LAYB] The app shell shows the brand logo from `brand.tsx` in its header.
 */

vi.mock("./DelegatedSessionBanner", () => ({ default: () => null }));

import Layout from "./Layout";

describe("[LAYB] layout branding", () => {
  afterEach(() => {
    cleanup();
  });

  it("[LAY1] renders the brand logo in the header", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Layout>
          <p>content</p>
        </Layout>
      </MemoryRouter>,
    );
    const logo = screen.getByRole("img", { name: "Pryv" });
    expect(logo.closest("header")).not.toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
  });
});

/**
 * [LYWD] The account section uses the wide layout token, the auth and
 * consent pages the narrow one.
 */
describe("[LYWD] layout width by route", () => {
  afterEach(() => cleanup());

  function mainAt(entry: string): HTMLElement {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Layout>
          <p>content</p>
        </Layout>
      </MemoryRouter>,
    );
    return screen.getByRole("main");
  }

  it("[LYW1] /account/... is wide", () => {
    for (const path of ["/account", "/account/profile", "/account/audit-access/a1", "/account/audit?kind=write"]) {
      const main = mainAt(path);
      expect(main.className).toContain("max-w-(--layout-account-max)");
      expect(main.getAttribute("data-layout")).toBe("wide");
      cleanup();
    }
  });

  it("[LYW2] auth and consent pages stay narrow", () => {
    for (const path of ["/signin", "/oauth2-authorize", "/accounting", "/"]) {
      const main = mainAt(path);
      expect(main.className).toContain("max-w-(--layout-narrow-max)");
      expect(main.getAttribute("data-layout")).toBe("narrow");
      cleanup();
    }
  });
});

/**
 * [LAYK] The header "Back to {label}" link: shown in a tab, not in a pop-up an
 * app opened, where following it would load the app inside the pop-up.
 */
describe("[LAYK] header back link", () => {
  const BACK = "/?backUrl=" + encodeURIComponent("https://app.example.test/back") + "&backLabel=App";

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "opener", { value: null, configurable: true, writable: true });
  });

  function renderAt(entry: string) {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Layout>
          <p>content</p>
        </Layout>
      </MemoryRouter>,
    );
  }

  it("[LAY2] a tab shows the link to backUrl with its host", () => {
    renderAt(BACK);
    const link = screen.getByRole("link", { name: /app\.example\.test/ });
    expect(link.getAttribute("href")).toBe("https://app.example.test/back");
  });

  it("[LAY3] a pop-up (opener set) does not show it", () => {
    Object.defineProperty(window, "opener", { value: {}, configurable: true, writable: true });
    renderAt(BACK);
    expect(screen.queryByRole("link", { name: /app\.example\.test/ })).toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
  });
});
