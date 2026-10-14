// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { CmcError, errorIds } from "@pryv/cmc";

/**
 * [MBRP] /account/memberships: an administrator opens a member's request link,
 * approves it for some or all of its teams (or declines it), lists the
 * members with Revoke, and follows the offboarding sweeps with their residuals.
 * Every call is made with the page's session (the owner's or a delegate's).
 */

const conn = vi.hoisted(() => {
  const c = {
    api: vi.fn(),
    // One stable object, as the real session provides.
    connection: {} as { api: unknown; apiEndpoint: string },
  };
  c.connection = { api: c.api, apiEndpoint: "https://session-token@group.core.test/" };
  return c;
});
vi.mock("../../lib/useSession", () => ({
  useSession: () => ({ connection: conn.connection, setConnection: vi.fn(), actingAs: null }),
}));

const cmcMock = vi.hoisted(() => ({
  readOffer: vi.fn(),
  acceptMembership: vi.fn(),
  declineMembership: vi.fn(),
  listMembers: vi.fn(),
  revokeMembership: vi.fn(),
  listSweeps: vi.fn(),
  getSweepStatus: vi.fn(),
}));
vi.mock("../../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

import Memberships from "./Memberships";

const CAP = "https://cap-token@bob.core.test/";
const TEAM_A = ":_cmc:apps:practice:team-a";
const TEAM_B = ":_cmc:apps:practice:team-b";

const MEMBERS = [
  {
    membershipAccessId: "m-1",
    member: { username: "carol", host: "core.test" },
    appCode: "practice",
    scopeStreamId: ":_cmc:apps:practice",
    scopes: [{ streamId: TEAM_A, level: "contribute" }],
    requestedScopes: [TEAM_A, TEAM_B],
    approvedBy: null,
    acceptEventId: "acc-1",
    created: 1789560000,
    expires: null,
  },
  {
    membershipAccessId: "m-2",
    member: { username: "dave", host: "other.test" },
    appCode: "practice",
    scopeStreamId: ":_cmc:apps:practice",
    scopes: [{ streamId: TEAM_B, level: "contribute" }],
    requestedScopes: [TEAM_B],
    approvedBy: { delegate: { username: "erin" }, relId: "rel-1" },
    acceptEventId: "acc-2",
    created: 1789560000,
    expires: null,
  },
];

function sweep(status: string, extra: Record<string, unknown> = {}) {
  return {
    sweepEventId: "sw-1",
    member: { username: "frank", host: "core.test" },
    membershipAccessId: "m-9",
    reason: "revoke",
    status,
    failure: null,
    records: [],
    outcome: [{ childAccessId: "c1", result: "deleted" }, { childAccessId: "c2", result: "residual" }],
    residuals: [{ counterparty: { username: "patient", host: "far.test" }, childAccessId: "c2", expires: 1789646400, reason: "unreachable" }],
    scopeStreamId: ":_cmc:apps:practice",
    time: 1789560000,
    ...extra,
  };
}

function membershipOffer(extra: Record<string, unknown> = {}) {
  return {
    requester: { username: "bob", host: "bob.core.test", displayName: "Dr Bob" },
    requestedPermissions: [
      { streamId: TEAM_A, level: "contribute" },
      { streamId: TEAM_B, level: "contribute" },
    ],
    consent: { en: "Let me join the practice." },
    allowUserChoice: true,
    accessType: "shared",
    membership: true,
    mode: "single-use",
    features: { chat: false, systemMessaging: true },
    ...extra,
  };
}

/** Shows where the page is, so a test can see what it left in the address. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{pathname + search}</p>;
}

function renderPage(entry = "/account/memberships") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/account/memberships"
          element={
            <>
              <Memberships />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(cmcMock)) fn.mockReset();
  conn.api.mockReset();
  conn.api.mockResolvedValue([
    {
      streams: [
        {
          id: ":_cmc:apps:practice",
          name: "Practice",
          children: [
            { id: TEAM_A, name: "Team A", children: [] },
            { id: TEAM_B, name: "Team B", children: [] },
          ],
        },
      ],
    },
  ]);
  cmcMock.listMembers.mockResolvedValue(MEMBERS);
  cmcMock.listSweeps.mockResolvedValue({ items: [], truncated: false });
  cmcMock.readOffer.mockResolvedValue(membershipOffer());
  cmcMock.acceptMembership.mockResolvedValue({ acceptEventId: "a-1", membershipAccessId: "m-3", member: {} });
  cmcMock.declineMembership.mockResolvedValue({ refuseEventId: "r-1" });
  cmcMock.revokeMembership.mockResolvedValue({ revokeEventId: "rv-1" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openPasted(link = CAP) {
  fireEvent.change(await screen.findByLabelText("Membership request link"), { target: { value: link } });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  return screen.findByTestId("membership-request");
}

describe("[MBRP] memberships page", () => {
  it("[MBP1] lists the members: account, teams by name, who approved them; nothing else of the access", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("membership-member");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("carol@core.test");
    expect(rows[0].textContent).toContain("Teams: Team A");
    expect(rows[0].textContent).toContain("Approved by the account owner");
    expect(rows[1].textContent).toContain("dave@other.test");
    expect(rows[1].textContent).toContain("Approved by erin (delegate)");
    expect(cmcMock.listMembers).toHaveBeenCalledWith(conn.connection);
    expect(document.body.textContent).not.toContain("token");
  });

  it("[MBP2] a pasted request: who asks, its teams ticked; Approve grants the teams kept, with the session", async () => {
    renderPage();
    const block = await openPasted("  " + CAP + " ");
    expect(cmcMock.readOffer).toHaveBeenCalledWith(CAP);
    expect(within(block).getByTestId("membership-requester").textContent).toBe("bob@bob.core.test");
    expect(block.textContent).toContain("(calls itself “Dr Bob”)");
    expect(block.textContent).toContain("Let me join the practice.");
    const a = within(block).getByLabelText("Team A") as HTMLInputElement;
    const b = within(block).getByLabelText("Team B") as HTMLInputElement;
    expect(a.checked && b.checked).toBe(true);
    fireEvent.click(b);
    fireEvent.click(within(block).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("bob@bob.core.test is now a member.")).toBeTruthy();
    expect(cmcMock.acceptMembership).toHaveBeenCalledWith(conn.connection, CAP, {
      scopeStreamId: ":_cmc:apps:practice",
      grantedScopes: [TEAM_A],
    });
    // The members are read again.
    expect(cmcMock.listMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("membership-request")).toBeNull();
  });

  it("[MBP3] opened from a link carrying the request: read at once; Decline answers it and leaves the address clean", async () => {
    const q = new URLSearchParams({ capabilityUrl: CAP, pryvServiceInfoUrl: "https://core.test/service/info" });
    renderPage("/account/memberships?" + q.toString());
    const block = await screen.findByTestId("membership-request");
    fireEvent.click(within(block).getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("The membership request from bob@bob.core.test was declined.")).toBeTruthy();
    expect(cmcMock.declineMembership).toHaveBeenCalledWith(conn.connection, CAP, { scopeStreamId: ":_cmc:apps:practice" });
    expect(cmcMock.acceptMembership).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/account/memberships?pryvServiceInfoUrl=" + encodeURIComponent("https://core.test/service/info"),
      ),
    );
  });

  it("[MBP4] a link that is not a membership request is not offered for approval", async () => {
    cmcMock.readOffer.mockResolvedValue(membershipOffer({ membership: false }));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Membership request link"), { target: { value: CAP } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText(/This link is not a membership request/)).toBeTruthy();
    expect(screen.queryByTestId("membership-request")).toBeNull();
    // Not a link at all: said without reading anything.
    cmcMock.readOffer.mockClear();
    fireEvent.change(screen.getByLabelText("Membership request link"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText(/This is not a membership request link/)).toBeTruthy();
    expect(cmcMock.readOffer).not.toHaveBeenCalled();
  });

  it("[MBP5] no team ticked: Approve is disabled and the page says why; Decline stays", async () => {
    renderPage();
    const block = await openPasted();
    fireEvent.click(within(block).getByLabelText("Team A"));
    fireEvent.click(within(block).getByLabelText("Team B"));
    expect((within(block).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(block).getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(false);
    expect(block.textContent).toContain("Tick at least one team, or decline the request.");
  });

  it("[MBP6] a refused approval is explained, and logs no token-bearing URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cmcMock.acceptMembership.mockRejectedValue(
      new CmcError("CMC accept failed for " + CAP, errorIds.MEMBERSHIP_PERMISSIONS_INVALID),
    );
    renderPage();
    const block = await openPasted();
    fireEvent.click(within(block).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/asks for more than team access/)).toBeTruthy();
    expect(screen.getByTestId("membership-request")).toBeTruthy();
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain("cap-token");
  });

  it("[MBP7] Revoke asks first in the page's own dialog; Cancel changes nothing, Revoke ends the membership", async () => {
    renderPage();
    const [row] = await screen.findAllByTestId("membership-member");
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("End the membership of carol@core.test?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(cmcMock.revokeMembership).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText(/The membership of carol@core.test has ended/)).toBeTruthy();
    expect(cmcMock.revokeMembership).toHaveBeenCalledWith(conn.connection, {
      membershipAccessId: "m-1",
      scopeStreamId: ":_cmc:apps:practice",
    });
    expect(cmcMock.listSweeps).toHaveBeenCalledTimes(2);
  });

  it("[MBP8] the offboarding sweeps: status, counts, residuals with their expiry; Check again re-reads one", async () => {
    cmcMock.listSweeps.mockResolvedValue({ items: [sweep("delivered")], truncated: false });
    cmcMock.getSweepStatus.mockResolvedValue(sweep("completed"));
    renderPage();
    const card = await screen.findByTestId("membership-sweep");
    expect(card.textContent).toContain("frank@core.test");
    expect(card.textContent).toContain("Membership revoked");
    expect(within(card).getByTestId("membership-sweep-status").textContent).toBe("In progress");
    expect(card.textContent).toContain("Removed: 1 · Already gone: 0 · Not removed: 1");
    const residuals = within(card).getByTestId("membership-residuals");
    expect(residuals.textContent).toContain("An access on patient@far.test could not be removed; it expires on");
    fireEvent.click(within(card).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(within(screen.getByTestId("membership-sweep")).getByTestId("membership-sweep-status").textContent).toBe("Done"));
    expect(cmcMock.getSweepStatus).toHaveBeenCalledWith(conn.connection, "sw-1");
    expect(within(screen.getByTestId("membership-sweep")).queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("[MBP9] lists that cannot be read are said, with no token shown", async () => {
    cmcMock.listMembers.mockRejectedValue(new Error("unreachable https://secret-token@group.core.test/"));
    cmcMock.listSweeps.mockRejectedValue(new Error("nope"));
    renderPage();
    expect(await screen.findByText(/unreachable https:\/\/\*\*\*@group.core.test/)).toBeTruthy();
    expect(screen.getByText("nope")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-token");
  });

  it("[MBP10] no members and no sweeps yet: said so", async () => {
    cmcMock.listMembers.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No members yet.")).toBeTruthy();
    expect(await screen.findByText("No membership has ended yet.")).toBeTruthy();
  });
});
