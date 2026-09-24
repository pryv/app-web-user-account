// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [CMRQ] The approval page names the requester by the account the capability
 * belongs to; the display name the requester gives itself is shown only as
 * its own claim, never in place of the account.
 */

const cmcMock = vi.hoisted(() => ({ readOffer: vi.fn() }));

vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

import CmcApprove from "./CmcApprove";
import { SessionProvider } from "../lib/session";

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/cmc-accept?capabilityUrl=https%3A%2F%2Fcap%40requester.test%2F&scopeStreamId=s1"]}>
      <SessionProvider>
        <CmcApprove />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("[CMRQ] /cmc-accept requester identity", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    cmcMock.readOffer.mockReset();
  });

  it("[CMR1] leads with the capability's account and attributes the self-asserted name", async () => {
    localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.core.test/");
    localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
    cmcMock.readOffer.mockResolvedValue({
      requester: { username: "mallory", host: "requester.test", displayName: "Your Bank" },
      requestedPermissions: [{ streamId: "diary", level: "read" }],
    });
    renderAt();
    const who = await screen.findByTestId("cmc-requester");
    expect(who.textContent).toBe("mallory@requester.test");
    expect(screen.getByText(/calls itself/).textContent).toContain("Your Bank");
  });

  it("[CMR2] without a verified account, never presents the self-asserted name as the requester", async () => {
    localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.core.test/");
    localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
    cmcMock.readOffer.mockResolvedValue({
      requester: { username: null, host: "", displayName: "Your Bank" },
      requestedPermissions: [],
    });
    renderAt();
    const who = await screen.findByTestId("cmc-requester");
    expect(who.textContent).toBe("An unidentified requester");
  });
});
