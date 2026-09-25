// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [DSBN] The reminder that a session acts for another account shows on every
 * page, from the server's access-info first and this browser's stack second.
 */

const accessInfo = vi.hoisted(() => vi.fn());

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        this.endpoint = apiEndpoint;
      }
      accessInfo() {
        return accessInfo();
      }
    },
  },
}));

import DelegatedSessionBanner from "./DelegatedSessionBanner";
import { SessionProvider } from "../lib/session";

function signedIn(): void {
  localStorage.setItem("pryv.session.apiEndpoint", "https://tok@kid.core.test/");
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <DelegatedSessionBanner />
        <p>page</p>
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[DSBN] delegated-session banner", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    accessInfo.mockReset();
  });

  it("[DSB1] shows on a page outside the account section from the server signal alone", async () => {
    signedIn();
    accessInfo.mockResolvedValue({
      delegation: { isDelegatedAccess: true, controlledUsername: "kid", delegate: { username: "parent" } },
    });
    renderAt("/auth?poll=x");
    const banner = await screen.findByTestId("delegated-session-banner");
    expect(banner.textContent).toContain("Acting as kid via parent");
    // No local stack: nothing to go back to.
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  it("[DSB2] offers the way back when this browser holds the stack", async () => {
    signedIn();
    localStorage.setItem("pryv.session.parent.apiEndpoint", "https://tok2@parent.core.test/");
    localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kid", parentUsername: "parent" }));
    accessInfo.mockResolvedValue({});
    renderAt("/account/profile");
    expect(await screen.findByRole("button", { name: "Back to parent" })).toBeTruthy();
  });

  it("[DSB4] names are inserted as text, never parsed as markup", async () => {
    signedIn();
    accessInfo.mockResolvedValue({
      delegation: { isDelegatedAccess: true, controlledUsername: "<b>kid</b>", delegate: { username: "<i>p</i>" } },
    });
    renderAt("/account/profile");
    const banner = await screen.findByTestId("delegated-session-banner");
    expect(banner.textContent).toContain("Acting as <b>kid</b> via <i>p</i>");
    expect(banner.querySelector("b")).toBeNull();
    expect(banner.querySelector("i")).toBeNull();
  });

  it("[DSB3] shows nothing for an ordinary session", async () => {
    signedIn();
    accessInfo.mockResolvedValue({ type: "personal" });
    renderAt("/account/profile");
    await waitFor(() => expect(accessInfo).toHaveBeenCalled());
    expect(screen.queryByTestId("delegated-session-banner")).toBeNull();
  });
});
