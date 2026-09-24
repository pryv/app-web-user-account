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
