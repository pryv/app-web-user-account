// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CmcError } from "@pryv/cmc";

/**
 * /auth: consent invites whose offer requires a verified email. Pinned here:
 * the account that answers the invite is the one read and proved, its Approve
 * waits for the proof, Decline keeps its meaning, the proof is read again right
 * before anything is written, and a refusal by the platform with nothing
 * accepted yet leaves the person on the page.
 */

const PLACEHOLDER = "a1b2c3d4e5f6g7h8i9j0@pryv.io";
const PAT = "delegate-pat-secret";
const PARENT = "https://parent-token@parent.core.test/";
const KID = "https://" + PAT + "@kid-a.core.test/";

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
            apiEndpoint: PARENT,
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

/** account.get / account.update, by token-bearing endpoint. */
const net = vi.hoisted(() => ({
  calls: [] as string[],
  updates: [] as unknown[],
  accounts: {} as Record<string, unknown>,
}));
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
      }
      async apiOne(method: string, params: { update?: unknown }) {
        net.calls.push(this.apiEndpoint + " " + method);
        if (method === "account.update") net.updates.push(params.update);
        return net.accounts[this.apiEndpoint];
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const POLL = "https://core.test/reg/access/k1";
const CAP_A = "https://cap-a@requester.test/";
const CAP_B = "https://cap-b@requester.test/";
const CAP_C = "https://cap-c@requester.test/";
const DIARY = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const WITH_EMAIL = [...DIARY, { streamId: ":system:email", level: "read", defaultName: "Email" }];

const entry = (value: string, primary: boolean, method: string | null, status = "verified") => ({
  value, primary, status, verifiedAt: null, verificationMethod: method,
});
const account = (...emails: Array<ReturnType<typeof entry>>) => ({ email: emails.find((e) => e.primary)?.value, emails });
const proved = (email: string) => account(entry(email, true, "email-link"));
const unproved = (email: string) => account(entry(email, true, "registration"));

type Invite = { capabilityUrl: string; mandatory: boolean; for: "self" | "target" };
const invite = (capabilityUrl: string, mandatory: boolean, who: "self" | "target" = "self"): Invite => ({
  capabilityUrl, mandatory, for: who,
});

function openAuth(cmcInvites: Invite[], extra: Record<string, unknown> = {}) {
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId: "carer-app",
    requestedPermissions: DIARY,
    serviceInfo: { api: "https://{username}.core.test/" },
    cmcInvites,
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function inviteBlocks(count: number) {
  const blocks = await screen.findAllByTestId("cmc-invite");
  expect(blocks).toHaveLength(count);
  for (const b of blocks) await within(b).findByTestId("cmc-requester");
  return blocks;
}

async function reachConsent(cmcInvites: Invite[]) {
  openAuth(cmcInvites);
  (await screen.findByText("sign-in-stub")).click();
  await screen.findByText(/is requesting permission/);
  return inviteBlocks(cmcInvites.length);
}

async function reachManagedConsent(cmcInvites: Invite[]) {
  deleg.serviceInfo = { features: { delegation: true, emailVerification: { atRegistration: false, onAccount: true } } };
  deleg.listControlled.mockResolvedValue([
    { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
  ]);
  deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
  openAuth(cmcInvites, { actAs: "kid-a" });
  (await screen.findByText("sign-in-stub")).click();
  await screen.findByText(/access to:/);
  screen.getByRole("button", { name: /continue for kid-a/i }).click();
  await screen.findByText(/is requesting permission/);
  return inviteBlocks(cmcInvites.length);
}

const buttonIn = (block: HTMLElement, name: string) => within(block).getByRole("button", { name }) as HTMLButtonElement;
const continueButton = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
/** Give the page the focus back until `check` holds (the listener joins an instant after the waiting text shows). */
const focusUntil = (check: () => void) =>
  waitFor(() => {
    fireEvent(window, new Event("focus"));
    check();
  });

/** Which offers require a verified email. */
function offers(required: Record<string, boolean>) {
  cmcMock.readOffer.mockImplementation(async (url: string) => ({
    requester: { username: url === CAP_A ? "doctor" : "study", host: "requester.test" },
    requestedPermissions: required[url] ? WITH_EMAIL : DIARY,
    mode: "single-use",
    ...(required[url] ? { requireVerifiedEmail: true } : {}),
  }));
}

const acceptedUrls = () => cmcMock.acceptInvite.mock.calls.map((c) => c[1]);
const refusalReason = () => flow.updateAccessState.mock.calls.map((c) => (c[1] as { reasonId?: string }).reasonId);
const verifiedRequired = () => new CmcError("CMC accept failed", "cmc-verified-email-required");
const REQUIRED_TEXT = /This request requires a verified email address on the account that approves it\./;

describe("/auth, invites requiring a verified email", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: DIARY });
    flow.createAppAccess.mockResolvedValue({ id: "acc-1", token: "app-token", type: "app", permissions: DIARY });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    for (const fn of Object.values(cmcMock)) fn.mockReset();
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" });
    offers({ [CAP_A]: true });
    scopeMock.readOfferRef.mockReset();
    scopeMock.readOfferRef.mockImplementation(async (url: string) => ({ scope: ":_cmc:apps:carer", offerEventId: "offer-" + url }));
    scopeMock.listGrants.mockReset();
    scopeMock.listGrants.mockResolvedValue([]);
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.serviceInfo = { features: { emailVerification: { atRegistration: false, onAccount: true } } };
    net.calls = [];
    net.updates = [];
    net.accounts = { [PARENT]: unproved("parent@example.com"), [KID]: account(entry(PLACEHOLDER, true, "registration")) };
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("[RVQ1] for a managed account, an invite for: 'self': the person's own account is read and proved, Approve waits", async () => {
    const [own] = await reachManagedConsent([invite(CAP_A, true, "self")]);
    const notice = await within(own).findByTestId("verified-email");
    expect(notice.textContent).toContain("doctor@requester.test requires a verified email address on this account.");
    expect(notice.textContent).toContain("parent@example.com is not verified yet");
    expect(notice.textContent).toContain("Declining it refuses the whole request.");
    expect(buttonIn(own, "Approve").disabled).toBe(true);
    expect(buttonIn(own, "Decline").disabled).toBe(false);
    buttonIn(own, "Send the verification email").click();
    await within(own).findByText(/Open the link we sent to parent@example.com/);
    expect(buttonIn(own, "Approve").disabled).toBe(true);
    net.accounts[PARENT] = proved("parent@example.com");
    await focusUntil(() => within(own).getByText("The email address parent@example.com is verified."));
    expect(buttonIn(own, "Approve").disabled).toBe(false);
    buttonIn(own, "Approve").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    // The managed account's address was never looked at.
    expect(net.calls.every((c) => c.startsWith(PARENT))).toBe(true);
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(cmcMock.acceptInvite.mock.calls[0][0].apiEndpoint).toBe(PARENT);
  });

  it("[RVQ2] an invite for: 'target': the managed account's own address, with the delegate token", async () => {
    // The person's own proved address does not help.
    net.accounts[PARENT] = proved("parent@example.com");
    const [kid] = await reachManagedConsent([invite(CAP_A, false, "target")]);
    const notice = await within(kid).findByTestId("verified-email");
    expect(notice.textContent).toContain("on the account kid-a: one of its own, yours does not count.");
    expect(notice.textContent).not.toContain("refuses the whole request");
    expect(buttonIn(kid, "Approve").disabled).toBe(true);
    const form = within(kid).getByTestId("verified-email-form");
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "kid@example.com" } });
    fireEvent.submit(form);
    await within(kid).findByText(/Open the link we sent to kid@example.com/);
    expect(net.updates).toEqual([{ emails: { add: ["kid@example.com"] } }]);
    expect(net.calls.every((c) => c.startsWith(KID))).toBe(true);
  });

  it("[RVQ8] a mandatory invite declined: REFUSED_MANDATORY_CONSENT, nothing accepted", async () => {
    const [block] = await reachConsent([invite(CAP_A, true)]);
    await within(block).findByTestId("verified-email");
    buttonIn(block, "Decline").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(refusalReason()).toEqual(["REFUSED_MANDATORY_CONSENT"]));
    expect(cmcMock.acceptInvite).not.toHaveBeenCalled();
    expect(flow.createAppAccess).not.toHaveBeenCalled();
  });

  it("[RVQ9] refused by the platform, on an optional invite: reported to the app as today", async () => {
    net.accounts[PARENT] = proved("parent@example.com");
    cmcMock.acceptInvite.mockRejectedValue(verifiedRequired());
    const [block] = await reachConsent([invite(CAP_A, false)]);
    await waitFor(() => expect(buttonIn(block, "Approve").disabled).toBe(false));
    buttonIn(block, "Approve").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(flow.updateAccessState.mock.calls[0][1]).toMatchObject({
      status: "ACCEPTED",
      cmcInvites: [{ reason: "cmc-verified-email-required" }],
    });
  });

  it("[RVQA] a consent already given: no notice, the account not read", async () => {
    scopeMock.listGrants.mockResolvedValue([
      { id: "g1", created: 1, clientData: { cmc: { role: "counterparty", offerEventId: "offer-" + CAP_A, acceptEventId: "acc-1" } } },
    ]);
    const [block] = await reachConsent([invite(CAP_A, true)]);
    await within(block).findByTestId("cmc-offer-given");
    await new Promise((r) => setTimeout(r, 30));
    expect(within(block).queryByTestId("verified-email")).toBeNull();
    expect(net.calls).toEqual([]);
    await waitFor(() => expect(continueButton().disabled).toBe(false));
  });

  it("[RVQ7] the app's own rows read the address, where registration asks for a proof: the form adds the address", async () => {
    deleg.serviceInfo = { features: { emailVerification: { atRegistration: true, onAccount: true } } };
    net.accounts[PARENT] = account(entry(PLACEHOLDER, true, "registration"));
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: WITH_EMAIL });
    openAuth([]);
    (await screen.findByText("sign-in-stub")).click();
    const form = await screen.findByTestId("missing-email-form");
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "parent@example.com" } });
    fireEvent.submit(form);
    await screen.findByText(/Open the link we sent to parent@example.com/);
    expect(net.updates).toEqual([{ emails: { add: ["parent@example.com"] } }]);
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[RVQD] no longer proved when continuing: read again before the first write, nothing written, the page stays", async () => {
    net.accounts[PARENT] = proved("parent@example.com");
    offers({ [CAP_A]: true, [CAP_B]: false });
    const [a, b] = await reachConsent([invite(CAP_A, true), invite(CAP_B, false)]);
    await within(a).findByText("The email address parent@example.com is verified.");
    buttonIn(a, "Approve").click();
    buttonIn(b, "Decline").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    const before = net.calls.length;
    net.accounts[PARENT] = unproved("other@example.com");
    continueButton().click();
    await screen.findByText(REQUIRED_TEXT);
    expect(net.calls.slice(before)).toEqual([PARENT + " account.get"]);
    expect(cmcMock.acceptInvite).not.toHaveBeenCalled();
    expect(cmcMock.refuseInvite).not.toHaveBeenCalled();
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    expect(flow.updateAccessState).not.toHaveBeenCalled();
    expect(within(a).getByTestId("verified-email").textContent).toContain("other@example.com is not verified yet");
    expect(buttonIn(a, "Approve").disabled).toBe(true);
    expect(buttonIn(a, "Decline").disabled).toBe(false);
    expect(continueButton().disabled).toBe(true);
    // Proved again: approved again, then everything goes through.
    buttonIn(a, "Send the verification email").click();
    await within(a).findByText(/Open the link we sent to other@example.com/);
    net.accounts[PARENT] = proved("other@example.com");
    await focusUntil(() => expect(buttonIn(a, "Approve").disabled).toBe(false));
    expect(continueButton().disabled).toBe(true);
    buttonIn(a, "Approve").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    expect(acceptedUrls()).toEqual([CAP_A]);
    expect(flow.updateAccessState.mock.calls[0][1]).toMatchObject({ status: "ACCEPTED" });
  });

  it("[RVQE] a mandatory invite refused by the platform: the page stays while nothing is accepted, else the request is refused", async () => {
    net.accounts[PARENT] = proved("parent@example.com");
    offers({ [CAP_A]: false, [CAP_B]: true, [CAP_C]: false });
    // CAP_B is last among equals in the request, and accepted first.
    const [a, b, c] = await reachConsent([invite(CAP_A, true), invite(CAP_B, true), invite(CAP_C, false)]);
    await within(b).findByText("The email address parent@example.com is verified.");
    buttonIn(a, "Approve").click();
    buttonIn(b, "Approve").click();
    buttonIn(c, "Decline").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    cmcMock.acceptInvite.mockRejectedValue(verifiedRequired());
    const before = net.calls.length;
    continueButton().click();
    await screen.findByText(REQUIRED_TEXT);
    await waitFor(() => expect(buttonIn(b, "Approve").disabled).toBe(false));
    expect(acceptedUrls()).toEqual([CAP_B]);
    expect(flow.updateAccessState).not.toHaveBeenCalled();
    expect(flow.closeOrRedirect).not.toHaveBeenCalled();
    // Read before the write, and again after the refusal.
    expect(net.calls.slice(before)).toEqual([PARENT + " account.get", PARENT + " account.get"]);
    // To be approved again; the declined one was answered, and stays declined.
    expect(continueButton().disabled).toBe(true);
    expect(cmcMock.refuseInvite).toHaveBeenCalledTimes(1);
    expect(within(c).queryByRole("button", { name: "Change" })).toBeNull();
    expect(within(a).getByRole("button", { name: "Change" })).toBeTruthy();

    // Second run: B goes through, then A (an offer whose requirement this page
    // does not know of) is refused: something is accepted, so the request ends.
    cmcMock.acceptInvite.mockReset();
    cmcMock.acceptInvite.mockImplementation(async (_conn: unknown, url: string) => {
      if (url === CAP_A) throw verifiedRequired();
      return { acceptEventId: "ev-1", dataGrantAccessId: "grant-1" };
    });
    buttonIn(b, "Approve").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(refusalReason()).toEqual(["MANDATORY_CONSENT_FAILED"]));
    expect(acceptedUrls()).toEqual([CAP_B, CAP_A]);
    expect(flow.createAppAccess).not.toHaveBeenCalled();
    // The refusal already sent is not sent twice.
    expect(cmcMock.refuseInvite).toHaveBeenCalledTimes(1);
  });

  it("a mandatory invite refused for an offer that did not say so: from then on it waits for the proof", async () => {
    offers({});
    cmcMock.acceptInvite.mockRejectedValue(verifiedRequired());
    const [a] = await reachConsent([invite(CAP_A, true)]);
    buttonIn(a, "Approve").click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await screen.findByText(REQUIRED_TEXT);
    await within(a).findByText("The email address parent@example.com is not verified yet.");
    expect(buttonIn(a, "Approve").disabled).toBe(true);
    expect(flow.updateAccessState).not.toHaveBeenCalled();
  });
});
