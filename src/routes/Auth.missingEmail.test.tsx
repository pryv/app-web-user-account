// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [AMEL] /auth: a consent that reads the account's email, on an account with
 * no address someone receives (the placeholder invented at registration).
 * Pinned here: the notice shows where the consent is (the app's rows, or the
 * invite's block), about the account the consent applies to (the managed
 * account for a `for: 'target'` invite answered for it); blocks on one account
 * share the read and the add; a failed read says nothing; Continue waits
 * while an address is being added.
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
const account = vi.hoisted(() => ({
  calls: [] as string[],
  emails: {} as Record<string, string | Error>,
  update: (async (_endpoint: string, email: string) => ({ email })) as (endpoint: string, email: string) => Promise<unknown>,
}));
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
      }
      async apiOne(method: string, params: { update?: { email: string } }) {
        account.calls.push(this.apiEndpoint + " " + method);
        if (method === "account.get") {
          const value = account.emails[this.apiEndpoint];
          if (value instanceof Error) throw value;
          return { username: "x", email: value ?? "someone@example.com" };
        }
        if (method === "account.update") return account.update(this.apiEndpoint, params.update!.email);
        throw new Error("unexpected " + method);
      }
    },
  },
}));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const POLL = "https://core.test/reg/access/k1";
const CAP_A = "https://cap-a@requester.test/";
const CAP_B = "https://cap-b@requester.test/";
const DIARY = [{ streamId: "diary", level: "read", defaultName: "Journal" }];
const WITH_EMAIL = [...DIARY, { streamId: ":system:email", level: "read", defaultName: "Email" }];

function needSignin(cmcInvites: unknown[], extra: Record<string, unknown> = {}) {
  return {
    status: "NEED_SIGNIN",
    requestingAppId: "carer-app",
    requestedPermissions: DIARY,
    serviceInfo: { api: "https://{username}.core.test/" },
    cmcInvites,
    ...extra,
  };
}

function openAuth(state: Record<string, unknown>) {
  flow.loadAccessState.mockResolvedValue(state);
  render(
    <MemoryRouter initialEntries={["/auth?poll=" + encodeURIComponent(POLL)]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function reachConsent(state: Record<string, unknown>) {
  openAuth(state);
  (await screen.findByText("sign-in-stub")).click();
  await screen.findByText(/is requesting permission/);
}

async function inviteBlocks(count: number) {
  const blocks = await screen.findAllByTestId("cmc-invite");
  expect(blocks).toHaveLength(count);
  for (const b of blocks) await within(b).findByTestId("cmc-requester");
  return blocks;
}

function continueButton(name = "Continue"): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("[AMEL] /auth missing email", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: DIARY });
    flow.createAppAccess.mockResolvedValue({ id: "acc-1", token: "app-token", type: "app", permissions: DIARY });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    cmcMock.readOffer.mockReset();
    cmcMock.acceptInvite.mockReset();
    cmcMock.refuseInvite.mockReset();
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "ev-1", dataGrantAccessId: "grant-1" });
    cmcMock.readOffer.mockImplementation(async (url: string) => ({
      requester: { username: url === CAP_A ? "doctor" : "study", host: "requester.test" },
      requestedPermissions: url === CAP_A ? WITH_EMAIL : DIARY,
      consent: { en: "I agree that you contact me at this address." },
      mode: "single-use",
    }));
    scopeMock.readOfferRef.mockReset();
    scopeMock.readOfferRef.mockImplementation(async (url: string) => ({ scope: ":_cmc:apps:carer", offerEventId: "offer-" + url }));
    scopeMock.listGrants.mockReset();
    scopeMock.listGrants.mockResolvedValue([]);
    deleg.listControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.serviceInfo = { features: {} };
    account.calls = [];
    account.emails = { [PARENT]: PLACEHOLDER };
    account.update = async (_e, email) => ({ email });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("[AME1] the app's own request reads the email: the notice under its rows, Accept available", async () => {
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: WITH_EMAIL });
    await reachConsent(needSignin([], { requestedPermissions: WITH_EMAIL }));
    const notice = await screen.findByTestId("missing-email");
    expect(notice.textContent).toContain("This account has no email address: add one so carer-app can reach you.");
    expect(continueButton("Accept").disabled).toBe(false);
    expect(account.calls).toEqual([PARENT + " account.get"]);
  });

  it("[AME2] an invite reads the email, the request does not: the notice on that block only", async () => {
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]));
    const blocks = await inviteBlocks(2);
    const notice = await within(blocks[0]).findByTestId("missing-email");
    expect(notice.textContent).toContain("add one so doctor@requester.test can reach you.");
    expect(within(blocks[1]).queryByTestId("missing-email")).toBeNull();
    expect(screen.getAllByTestId("missing-email")).toHaveLength(1);
  });

  it("[AME3] for a managed account: a for: 'target' invite reads and names that account; a for: 'self' one reads the person's own", async () => {
    deleg.serviceInfo = { features: { delegation: true } };
    deleg.listControlled.mockResolvedValue([
      { relId: "r1", controlled: { username: "kid-a", hostSlug: "core-b" }, status: "active", requestedAt: 1 },
    ]);
    deleg.getToken.mockResolvedValue({ token: PAT, apiEndpoint: "https://kid-a.core.test/" });
    account.emails = { [PARENT]: "parent@example.com", [KID]: PLACEHOLDER };
    cmcMock.readOffer.mockImplementation(async (url: string) => ({
      requester: { username: url === CAP_A ? "doctor" : "study", host: "requester.test" },
      requestedPermissions: WITH_EMAIL,
      mode: "single-use",
    }));
    openAuth(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "target" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }], { actAs: "kid-a" }));
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/access to:/);
    screen.getByRole("button", { name: /continue for kid-a/i }).click();
    await screen.findByText(/is requesting permission/);
    // Grouped by account: the person's own consents first, then the managed account's.
    const [own, kid] = await inviteBlocks(2);
    const notice = await within(kid).findByTestId("missing-email");
    expect(notice.textContent).toContain("kid-a has no email address: add one so doctor@requester.test can reach them.");
    await waitFor(() => expect(account.calls).toContain(PARENT + " account.get"));
    expect(account.calls).toContain(KID + " account.get");
    expect(within(own).queryByTestId("missing-email")).toBeNull();
  });

  it("[AME4] one account, one address: an add on one block settles every block on that account", async () => {
    cmcMock.readOffer.mockImplementation(async (url: string) => ({
      requester: { username: url === CAP_A ? "doctor" : "study", host: "requester.test" },
      requestedPermissions: WITH_EMAIL,
      mode: "single-use",
    }));
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }, { capabilityUrl: CAP_B, mandatory: false, for: "self" }]));
    const blocks = await inviteBlocks(2);
    await within(blocks[0]).findByTestId("missing-email");
    await within(blocks[1]).findByTestId("missing-email");
    // One read for the one account.
    expect(account.calls.filter((c) => c.endsWith("account.get"))).toEqual([PARENT + " account.get"]);
    fireEvent.change(within(blocks[0]).getByLabelText("Email address"), { target: { value: "parent@example.com" } });
    fireEvent.submit(within(blocks[0]).getByTestId("missing-email-form"));
    for (const b of blocks) {
      await within(b).findByText("parent@example.com is now this account's email address.");
    }
    expect(account.calls.filter((c) => c.endsWith("account.update"))).toEqual([PARENT + " account.update"]);
  });

  it("[AME5] the account cannot be read: no notice, the flow goes on", async () => {
    account.emails = { [PARENT]: new Error("could not reach https://parent-token@parent.core.test/") };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    const logged = warn.mock.calls.flat().map(String).join(" ");
    warn.mockRestore();
    expect(logged).toContain("could not read the account's email");
    expect(logged).not.toContain("parent-token");
    expect(within(block).queryByTestId("missing-email")).toBeNull();
    within(block).getByRole("button", { name: "Approve" }).click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    continueButton().click();
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
  });

  it("[AME6] Continue waits while an address is being added", async () => {
    let release: (v: unknown) => void = () => {};
    account.update = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    await within(block).findByTestId("missing-email");
    within(block).getByRole("button", { name: "Approve" }).click();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.change(within(block).getByLabelText("Email address"), { target: { value: "parent@example.com" } });
    fireEvent.submit(within(block).getByTestId("missing-email-form"));
    await waitFor(() => expect(continueButton().disabled).toBe(true));
    release({ email: "parent@example.com" });
    await within(block).findByText(/is now this account's email address/);
    expect(continueButton().disabled).toBe(false);
  });

  it("[AME8] the added notice shows the address the platform now holds, not the one typed", async () => {
    account.update = async () => ({ email: "parent@example.org" });
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    await within(block).findByTestId("missing-email");
    fireEvent.change(within(block).getByLabelText("Email address"), { target: { value: "Parent@Example.org" } });
    fireEvent.submit(within(block).getByTestId("missing-email-form"));
    await within(block).findByText("parent@example.org is now this account's email address.");
    expect(within(block).queryByText(/Parent@Example\.org/)).toBeNull();
  });

  it("[AME7] a consent already given: nothing to grant, no notice, the account not read", async () => {
    scopeMock.listGrants.mockResolvedValue([
      { id: "g1", created: 1, clientData: { cmc: { role: "counterparty", offerEventId: "offer-" + CAP_A, acceptEventId: "acc-1" } } },
    ]);
    await reachConsent(needSignin([{ capabilityUrl: CAP_A, mandatory: true, for: "self" }]));
    const [block] = await inviteBlocks(1);
    await within(block).findByTestId("cmc-offer-given");
    await new Promise((r) => setTimeout(r, 30));
    expect(within(block).queryByTestId("missing-email")).toBeNull();
    expect(account.calls).toEqual([]);
  });
});
