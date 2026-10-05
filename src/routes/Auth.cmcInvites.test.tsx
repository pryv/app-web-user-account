// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [ACI] `/auth` with consent invites in the access request (`cmcInvites`).
 * Pinned here: the invite blocks come after check-app and Continue waits for
 * every decision; the order decide, accept, grant; a declined mandatory invite
 * refuses before anything is written; a failed mandatory accept refuses
 * without a grant; an optional failure or decline is reported and the grant
 * proceeds; `for: 'target'` is accepted with the delegate token, or as self
 * (and said so) when there is no account to act for.
 */

const flow = vi.hoisted(() => ({
  loadAccessState: vi.fn(),
  updateAccessState: vi.fn(),
  checkAppAccess: vi.fn(),
  createAppAccess: vi.fn(),
  deleteAppAccess: vi.fn(),
  closeOrRedirect: vi.fn(),
  deriveServiceInfoUrlFromPollUrl: vi.fn(() => "https://core.test/service/info"),
}));
vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
}));

const cmcMock = vi.hoisted(() => ({ readOffer: vi.fn(), acceptInvite: vi.fn(), refuseInvite: vi.fn() }));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

const scopeMock = vi.hoisted(() => ({ readOfferRef: vi.fn(), listGrants: vi.fn() }));
vi.mock("../lib/cmcInvites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/cmcInvites")>()),
  ...scopeMock,
}));

const deleg = vi.hoisted(() => ({
  listControlled: vi.fn(),
  getToken: vi.fn(),
  serviceInfo: { features: {} } as Record<string, unknown>,
}));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return {
    ...actual,
    Delegation: { fromConnection: () => ({ listControlled: deleg.listControlled, getToken: deleg.getToken }) },
  };
});

vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({ onSignedIn }: { onSignedIn: (s: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        void onSignedIn({
          username: "parent",
          personalToken: "parent-token",
          endpoint: "https://parent.core.test/",
          connection: {
            apiEndpoint: "https://parent-token@parent.core.test/",
            endpoint: "https://parent.core.test/",
            username: async () => "parent",
            service: { info: async () => deleg.serviceInfo },
          },
        })
      }
    >
      sign-in-stub
    </button>
  ),
}));

// The connection each accept is made with: its token-bearing endpoint.
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const PAT = "delegate-pat-secret";
const PERMS = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const POLL = "https://core.test/reg/access/k1";
const CAP_A = "https://cap-a@requester.test/";
const CAP_B = "https://cap-b@requester.test/";

const grantOf = (id: string, offerEventId: string, acceptEventId: string, created: number | null) => ({
  id,
  created,
  clientData: { cmc: { role: "counterparty", offerEventId, acceptEventId } },
});

/** What happened, in order: accepts and access writes on one timeline. */
let timeline: string[] = [];

function needSignin(cmcInvites: unknown[], extra: Record<string, unknown> = {}) {
  return {
    status: "NEED_SIGNIN",
    requestingAppId: "carer-app",
    requestedPermissions: PERMS,
    serviceInfo: { api: "https://{username}.core.test/" },
    cmcInvites,
    ...extra,
  };
}

async function reachConsent(state: Record<string, unknown>) {
  flow.loadAccessState.mockResolvedValue(state);
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  (await screen.findByText("sign-in-stub")).click();
  await screen.findByText(/is requesting permission/);
}

/** The invite blocks, once every offer is read. */
async function inviteBlocks(count: number) {
  const blocks = await screen.findAllByTestId("cmc-invite");
  expect(blocks).toHaveLength(count);
  for (const b of blocks) await within(b).findByTestId("cmc-requester");
  return blocks;
}

function decide(block: HTMLElement, choice: "Approve" | "Decline") {
  within(block).getByRole("button", { name: choice }).click();
}

function continueButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
}

function posted(): Record<string, unknown> {
  return flow.updateAccessState.mock.calls[0][1] as Record<string, unknown>;
}

describe("[ACI] /auth: consent invites in the access request", () => {
  beforeEach(() => {
    timeline = [];
    for (const fn of Object.values(flow)) fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: PERMS });
    flow.createAppAccess.mockImplementation(async () => {
      timeline.push("createAppAccess");
      return { id: "acc-1", token: "app-token", type: "app", permissions: PERMS };
    });
    flow.updateAccessState.mockImplementation(async (_poll: string, body: { status?: string }) => {
      timeline.push("post " + body.status);
      return { status: 200 };
    });
    cmcMock.readOffer.mockReset();
    cmcMock.acceptInvite.mockReset();
    cmcMock.refuseInvite.mockReset();
    cmcMock.refuseInvite.mockImplementation(async (conn: { apiEndpoint: string }, url: string) => {
      timeline.push("refuseInvite " + url + " " + conn.apiEndpoint);
      return { refuseEventId: "rf-1" };
    });
    cmcMock.readOffer.mockImplementation(async (url: string) => ({
      requester: { username: url === CAP_A ? "doctor" : "study", host: "requester.test" },
      requestedPermissions: [{ streamId: "diary", level: "read" }],
      consent: { en: "Share your diary." },
      mode: "single-use",
    }));
    let n = 0;
    cmcMock.acceptInvite.mockImplementation(async (conn: { apiEndpoint: string }, url: string) => {
      timeline.push("acceptInvite " + url + " " + conn.apiEndpoint);
      n += 1;
      return { acceptEventId: "ev-" + n, dataGrantAccessId: "grant-" + n, counterparty: null, features: {} };
    });
    scopeMock.readOfferRef.mockReset();
    scopeMock.readOfferRef.mockImplementation(async (url: string) => ({
      scope: ":_cmc:apps:carer",
      offerEventId: url === CAP_A ? "offer-a" : "offer-b",
    }));
    scopeMock.listGrants.mockReset();
    scopeMock.listGrants.mockResolvedValue([]);
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.serviceInfo = { features: {} };
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[ACI1] the invite blocks come after check-app; Continue waits for every decision", async () => {
    flow.loadAccessState.mockResolvedValue(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/is requesting permission/);
    // Not read before the consent step.
    expect(flow.checkAppAccess.mock.invocationCallOrder[0]).toBeLessThan(cmcMock.readOffer.mock.invocationCallOrder[0]);
    const blocks = await inviteBlocks(2);
    expect(within(blocks[0]).getByTestId("cmc-requester").textContent).toBe("doctor@requester.test");
    expect(blocks[0].textContent).toContain("required");
    expect(blocks[1].textContent).toContain("optional");
    // The page's Accept is Continue, disabled until every block is decided.
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(continueButton().disabled).toBe(true);
    decide(blocks[0], "Approve");
    await waitFor(() => expect(within(blocks[0]).getByTestId("cmc-offer-decision")).toBeTruthy());
    expect(continueButton().disabled).toBe(true);
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    // A decision can be changed.
    within(blocks[1]).getByRole("button", { name: "Change" }).click();
    await waitFor(() => expect(continueButton().disabled).toBe(true));
    // Nothing was written while deciding.
    expect(cmcMock.acceptInvite).not.toHaveBeenCalled();
    expect(cmcMock.refuseInvite).not.toHaveBeenCalled();
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(flow.updateAccessState).not.toHaveBeenCalled();
  });

  it("[ACI2] a declined mandatory invite refuses the request before any write", async () => {
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }, { capabilityUrl: CAP_B, mandatory: true, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("REFUSED");
    expect(posted().reasonId).toBe("REFUSED_MANDATORY_CONSENT");
    expect(typeof posted().message).toBe("string");
    expect(posted().cmcInvites).toBeUndefined();
    expect(cmcMock.acceptInvite).not.toHaveBeenCalled();
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(flow.updateAccessState).toHaveBeenCalledTimes(1);
    // The declined requester is told no, before the request is refused.
    expect(cmcMock.refuseInvite).toHaveBeenCalledTimes(1);
    expect(cmcMock.refuseInvite.mock.calls[0][1]).toBe(CAP_B);
    expect(cmcMock.refuseInvite.mock.calls[0][2]).toEqual({ scopeStreamId: ":_cmc:apps:carer" });
    expect(timeline).toEqual(["refuseInvite " + CAP_B + " https://parent-token@parent.core.test/", "post REFUSED"]);
  });

  it("[ACI14] a declined invite is answered with a refusal before the grant; a failed refusal changes nothing", async () => {
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    let blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(cmcMock.refuseInvite).toHaveBeenCalledTimes(1);
    expect(cmcMock.refuseInvite.mock.calls[0].slice(1)).toEqual([CAP_B, { scopeStreamId: ":_cmc:apps:carer" }]);
    expect(timeline.indexOf("refuseInvite " + CAP_B + " https://parent-token@parent.core.test/")).toBeLessThan(
      timeline.indexOf("createAppAccess"),
    );
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" }, { declined: true }]);
    cleanup();
    localStorage.clear();
    sessionStorage.clear();

    // A refusal that cannot be sent: the outcome is the same, the grant proceeds.
    flow.updateAccessState.mockClear();
    flow.createAppAccess.mockClear();
    cmcMock.refuseInvite.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("ACCEPTED");
    expect((posted().cmcInvites as unknown[])[1]).toEqual({ declined: true });
    expect(flow.createAppAccess).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("[ACI15] a mandatory accept whose wait times out is reported, not refused", async () => {
    cmcMock.acceptInvite.mockRejectedValue(
      Object.assign(new Error("trigger did not complete"), { id: "cmc-capability-timeout" }),
    );
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("ACCEPTED");
    expect(posted().cmcInvites).toEqual([{ reason: "cmc-capability-timeout" }]);
    expect(flow.createAppAccess).toHaveBeenCalledTimes(1);
  });

  it("[ACI16] an offer that names no scope: Approve disabled, Decline available, said so; nothing to refuse with", async () => {
    scopeMock.readOfferRef.mockResolvedValue({ scope: null, offerEventId: "offer-a" });
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }]));
    const [block] = await inviteBlocks(1);
    within(block).getByText(/does not say where its consent belongs/);
    expect((within(block).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(block).getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(false);
    decide(block, "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(cmcMock.refuseInvite).not.toHaveBeenCalled();
    expect(posted().cmcInvites).toEqual([{ declined: true }]);
  });

  it("[ACI3] a declined optional invite: the grant proceeds, the outcome says declined", async () => {
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("ACCEPTED");
    expect(posted().token).toBe("app-token");
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" }, { declined: true }]);
    expect(cmcMock.acceptInvite).toHaveBeenCalledTimes(1);
    expect(cmcMock.acceptInvite.mock.calls[0][1]).toBe(CAP_A);
    expect(cmcMock.acceptInvite.mock.calls[0][2]).toEqual({ scopeStreamId: ":_cmc:apps:carer" });
  });

  it("[ACI4] a mandatory accept that fails refuses the request with its reason, no grant", async () => {
    cmcMock.acceptInvite.mockRejectedValue(
      Object.assign(new Error("CMC accept failed"), { id: "cmc-capability-consumed" }),
    );
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("REFUSED");
    expect(posted().reasonId).toBe("MANDATORY_CONSENT_FAILED");
    expect(String(posted().message)).toContain("cmc-capability-consumed");
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(flow.updateAccessState).toHaveBeenCalledTimes(1);
  });

  it("[ACI11] an optional accept that fails is reported, and the grant proceeds", async () => {
    cmcMock.acceptInvite.mockImplementation(async (_conn: unknown, url: string) => {
      if (url === CAP_B) throw Object.assign(new Error("CMC accept failed"), { id: "cmc-capability-invalidated" });
      return { acceptEventId: "ev-a", dataGrantAccessId: null, counterparty: null, features: {} };
    });
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("ACCEPTED");
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-a" }, { reason: "cmc-capability-invalidated" }]);
    expect(flow.createAppAccess).toHaveBeenCalledTimes(1);
  });

  it("[ACI5] every invite is accepted before the app access is created", async () => {
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_B, mandatory: false, for: "self" }, { capabilityUrl: CAP_A, mandatory: true, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(timeline).toEqual([
      // mandatory first, then optional
      "acceptInvite " + CAP_A + " https://parent-token@parent.core.test/",
      "acceptInvite " + CAP_B + " https://parent-token@parent.core.test/",
      "createAppAccess",
      "post ACCEPTED",
    ]);
    // Outcomes in the request's order.
    expect(posted().cmcInvites).toEqual([
      { acceptEventId: "ev-2", dataGrantAccessId: "grant-2" },
      { acceptEventId: "ev-1", dataGrantAccessId: "grant-1" },
    ]);
  });

  it("[ACI6] for: 'target' is accepted with the delegate token on the controlled account", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    flow.loadAccessState.mockResolvedValue(
      needSignin(
        [{ capabilityUrl: CAP_A, mandatory: true, for: "target" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }],
        { actAs: "kid-a" },
      ),
    );
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/access to:/);
    screen.getByRole("button", { name: /continue for kid-a/i }).click();
    await screen.findByText(/is requesting permission/);
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const byUrl = Object.fromEntries(
      cmcMock.acceptInvite.mock.calls.map((c) => [c[1] as string, (c[0] as { apiEndpoint: string }).apiEndpoint]),
    );
    expect(byUrl[CAP_A]).toBe("https://" + PAT + "@kid-a.core.test/");
    expect(byUrl[CAP_B]).toBe("https://parent-token@parent.core.test/");
    expect(posted().status).toBe("ACCEPTED");
    expect(posted().username).toBe("kid-a");
    const outcomes = posted().cmcInvites as Array<Record<string, unknown>>;
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].acceptedFor).toBeUndefined();
    expect(JSON.stringify(posted())).not.toContain(PAT);
  });

  it("[ACI7] for: 'target' without an account to act for is accepted as self, and said so", async () => {
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "target" }]));
    const [block] = await inviteBlocks(1);
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect((cmcMock.acceptInvite.mock.calls[0][0] as { apiEndpoint: string }).apiEndpoint).toBe(
      "https://parent-token@parent.core.test/",
    );
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-1", dataGrantAccessId: "grant-1", acceptedFor: "self" }]);
  });

  it("[ACI24] an invite's accessName names the grant: passed to the accept; none without one", async () => {
    await reachConsent(
      needSignin([
        { capabilityUrl: CAP_A, mandatory: true, for: "self", accessName: "Diary study 2026" },
        { capabilityUrl: CAP_B, mandatory: false, for: "self" },
      ]),
    );
    const blocks = await inviteBlocks(2);
    decide(blocks[0], "Approve");
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const optsByUrl = Object.fromEntries(
      cmcMock.acceptInvite.mock.calls.map((c) => [c[1] as string, c[2] as Record<string, unknown>]),
    );
    expect(optsByUrl[CAP_A]).toEqual({ scopeStreamId: ":_cmc:apps:carer", accessName: "Diary study 2026" });
    expect("accessName" in optsByUrl[CAP_B]).toBe(false);
  });

  it("[ACI25] the app asks for a managed account: a for: 'target' invite is answered with the account chosen, never as self", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    flow.loadAccessState.mockResolvedValue(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "target" }], { actAs: "allow", actAsManagedOnly: true }),
    );
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/access to:/);
    expect(screen.queryByRole("radio", { name: /\(me\)/ })).toBeNull();
    (screen.getByDisplayValue("kid-a") as HTMLInputElement).click();
    (await screen.findByRole("button", { name: /continue for kid-a/i })).click();
    await screen.findByText(/is requesting permission/);
    const [block] = await inviteBlocks(1);
    expect(within(block).getByTestId("cmc-invite-for").textContent).toBe("For kid-a, whom you look after");
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect((cmcMock.acceptInvite.mock.calls[0][0] as { apiEndpoint: string }).apiEndpoint).toBe(
      "https://" + PAT + "@kid-a.core.test/",
    );
    expect(posted().username).toBe("kid-a");
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" }]);
  });

  it("[ACI26] the accesses of one account are listed once for all its invites", async () => {
    scopeMock.listGrants.mockResolvedValue([grantOf("grant-old", "offer-b", "accept-old", null)]);
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    await within(blocks[1]).findByTestId("cmc-offer-given");
    expect(within(blocks[0]).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(scopeMock.listGrants).toHaveBeenCalledTimes(1);
    expect(scopeMock.listGrants).toHaveBeenCalledWith("https://parent-token@parent.core.test/");
  });

  it("[ACI27] what is logged when an invite's offer, grants or refusal fail names no token-bearing URL", async () => {
    cmcMock.readOffer.mockImplementation(async (url: string) => {
      if (url === CAP_B) throw new Error("cannot read " + CAP_B);
      return { requester: { username: "doctor", host: "requester.test" }, requestedPermissions: [], mode: "single-use" };
    });
    scopeMock.listGrants.mockRejectedValue(
      Object.assign(new Error("accesses.get failed"), { innerObject: { message: "denied for https://parent-token@parent.core.test/" } }),
    );
    cmcMock.refuseInvite.mockRejectedValue(new Error("refusal to " + CAP_A + " failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await screen.findAllByTestId("cmc-invite");
    await within(blocks[1]).findByText(/could not be read/);
    await within(blocks[0]).findByTestId("cmc-requester");
    decide(blocks[0], "Decline");
    decide(blocks[1], "Decline");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const logged = warn.mock.calls;
    warn.mockRestore();
    // The offer, the grants and the refusal each said why.
    expect(logged.length).toBeGreaterThanOrEqual(3);
    for (const args of logged) {
      for (const a of args) {
        expect(typeof a).toBe("string");
        for (const secret of ["parent-token", "cap-a@", "cap-b@"]) expect(a as string).not.toContain(secret);
      }
    }
  });

  it("[ACI28] a listing that fails is said once, however many invites share it", async () => {
    scopeMock.listGrants.mockRejectedValue(new Error("403"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    for (const b of blocks) expect(within(b).getByRole("button", { name: "Approve" })).toBeTruthy();
    const said = warn.mock.calls.filter((c) => String(c[0]).includes("already given"));
    warn.mockRestore();
    expect(said).toHaveLength(1);
  });

  it("[ACI9] an unreadable invite can only be declined", async () => {
    cmcMock.readOffer.mockImplementation(async (url: string) => {
      if (url === CAP_B) throw new Error("capability gone");
      return { requester: { username: "doctor", host: "requester.test" }, requestedPermissions: [], mode: "single-use" };
    });
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await screen.findAllByTestId("cmc-invite");
    await within(blocks[1]).findByText(/could not be read/);
    expect((within(blocks[1]).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(blocks[1]).getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[ACI12] (guard) a request without invites: Accept as before, the same ACCEPTED body, no offer read", async () => {
    const state = needSignin([]);
    delete (state as { cmcInvites?: unknown }).cmcInvites;
    await reachConsent(state);
    expect(screen.queryAllByTestId("cmc-invite")).toHaveLength(0);
    screen.getByRole("button", { name: "Accept" }).click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted()).toEqual({
      status: "ACCEPTED",
      username: "parent",
      apiEndpoint: "https://app-token@parent.core.test/",
      token: "app-token",
    });
    expect(cmcMock.readOffer).not.toHaveBeenCalled();
    expect(scopeMock.readOfferRef).not.toHaveBeenCalled();
    expect(scopeMock.listGrants).not.toHaveBeenCalled();
  });

  it("[ACI10] (guard) an access the app already holds is not handed over before the invites are answered", async () => {
    flow.checkAppAccess.mockResolvedValue({
      matchingAccess: { id: "m1", token: "existing-token", type: "app", permissions: PERMS },
    });
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }]));
    const [block] = await inviteBlocks(1);
    expect(flow.updateAccessState).not.toHaveBeenCalled();
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(posted().token).toBe("existing-token");
    expect(posted().cmcInvites).toEqual([{ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" }]);
  });

  /** Through "who is this for?", continuing for `pick` (the controlled kid-a, or the signed-in parent). */
  async function reachViaGrantFor(cmcInvites: unknown[], pick: "kid-a" | "parent") {
    deleg.serviceInfo = { features: { delegation: true } };
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    flow.loadAccessState.mockResolvedValue(needSignin(cmcInvites, { actAs: "kid-a" }));
    render(
      <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/access to:/);
    if (pick === "parent") (screen.getByRole("radio", { name: /\(me\)/ }) as HTMLInputElement).click();
    (await screen.findByRole("button", { name: new RegExp("continue for " + pick, "i") })).click();
    await screen.findByText(/is requesting permission/);
  }

  it("[ACI17] after \"who is this for?\", each block names the account its consent is for", async () => {
    await reachViaGrantFor(
      [{ capabilityUrl: CAP_A, mandatory: true, for: "target" }, { capabilityUrl: CAP_B, mandatory: true, for: "self" }],
      "kid-a",
    );
    const blocks = await inviteBlocks(2);
    expect(within(blocks[0]).getByTestId("cmc-invite-for").textContent).toBe("For kid-a, whom you look after");
    expect(within(blocks[1]).getByTestId("cmc-invite-for").textContent).toBe("For you (parent)");
    // Part of the heading, so the block is announced with it.
    expect(within(blocks[0]).getByRole("heading").textContent).toContain("For kid-a, whom you look after");
  });

  it("[ACI18] the carer picked their own account: a for: 'target' block reads \"For you\"", async () => {
    await reachViaGrantFor([{ capabilityUrl: CAP_A, mandatory: true, for: "target" }], "parent");
    const [block] = await inviteBlocks(1);
    expect(within(block).getByTestId("cmc-invite-for").textContent).toBe("For you (parent)");
  });

  it("[ACI19] (guard) without \"who is this for?\", the headings name no account", async () => {
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "target" }]),
    );
    const blocks = await inviteBlocks(2);
    for (const b of blocks) expect(within(b).queryByTestId("cmc-invite-for")).toBeNull();
  });

  it("[ACI20] an offer this account already accepted shows as given: no Approve/Decline, counts as accepted, nothing written", async () => {
    scopeMock.listGrants.mockResolvedValue([grantOf("grant-old", "offer-a", "accept-old", 1_700_000_000)]);
    await reachConsent(
      needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]),
    );
    const blocks = await inviteBlocks(2);
    await within(blocks[0]).findByTestId("cmc-offer-given");
    expect(within(blocks[0]).getByTestId("cmc-offer-given").textContent).toMatch(/^Already given on .+\. It is kept as it is\.$/);
    expect(within(blocks[0]).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(blocks[0]).queryByRole("button", { name: "Decline" })).toBeNull();
    expect(within(blocks[0]).queryByRole("button", { name: "Change" })).toBeNull();
    // Checked on the account the invite applies to, for this offer.
    expect(scopeMock.listGrants).toHaveBeenCalledWith("https://parent-token@parent.core.test/");
    // The given (mandatory) invite counts as decided: only the other one is waited for.
    expect(continueButton().disabled).toBe(true);
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(posted().status).toBe("ACCEPTED");
    expect(cmcMock.acceptInvite).toHaveBeenCalledTimes(1);
    expect(cmcMock.acceptInvite.mock.calls[0][1]).toBe(CAP_B);
    expect(cmcMock.refuseInvite).not.toHaveBeenCalled();
    expect(posted().cmcInvites).toEqual([
      { acceptEventId: "accept-old", dataGrantAccessId: "grant-old" },
      { acceptEventId: "ev-1", dataGrantAccessId: "grant-1" },
    ]);
  });

  it("[ACI21] a for: 'target' invite is checked on the controlled account, with its delegate token", async () => {
    scopeMock.listGrants.mockImplementation(async (api: string) =>
      api === "https://" + PAT + "@kid-a.core.test/" ? [grantOf("g-kid", "offer-a", "a-kid", null)] : [],
    );
    await reachViaGrantFor(
      [{ capabilityUrl: CAP_A, mandatory: true, for: "target" }, { capabilityUrl: CAP_B, mandatory: true, for: "self" }],
      "kid-a",
    );
    const blocks = await inviteBlocks(2);
    expect(scopeMock.listGrants).toHaveBeenCalledWith("https://" + PAT + "@kid-a.core.test/");
    expect(scopeMock.listGrants).toHaveBeenCalledWith("https://parent-token@parent.core.test/");
    expect((await within(blocks[0]).findByTestId("cmc-offer-given")).textContent).toBe("Already given. It is kept as it is.");
    // The parent's own invite was not given on the parent's account: a full block.
    expect(within(blocks[1]).getByRole("button", { name: "Approve" })).toBeTruthy();
    decide(blocks[1], "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect((posted().cmcInvites as unknown[])[0]).toEqual({ acceptEventId: "a-kid", dataGrantAccessId: "g-kid" });
    expect(cmcMock.acceptInvite.mock.calls.map((c) => c[1])).toEqual([CAP_B]);
  });

  it("[ACI22] when the accesses cannot be listed, the invite is shown as usual", async () => {
    scopeMock.listGrants.mockRejectedValue(new Error("403"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    expect(within(block).queryByTestId("cmc-offer-given")).toBeNull();
    expect((within(block).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
    expect(continueButton().disabled).toBe(true);
    decide(block, "Approve");
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(cmcMock.acceptInvite).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("[ACI23] the access the app already holds is listed with the names the request gave its streams", async () => {
    flow.checkAppAccess.mockResolvedValue({
      // Read back from the account: no display names.
      matchingAccess: { id: "m1", token: "existing-token", type: "app", permissions: [{ streamId: "diary", level: "read" }] },
    });
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: false, for: "self" }]));
    await inviteBlocks(1);
    screen.getByText("This app already holds this access. It is kept as it is.");
    // The app-access rows, not the invite's (which carry their own list).
    expect(screen.getAllByText("Read “Journal”").length).toBeGreaterThan(0);
    expect(screen.queryByText("Read “diary”", { exact: false, ignore: "[data-testid=cmc-invite] *" })).toBeNull();
  });
});
