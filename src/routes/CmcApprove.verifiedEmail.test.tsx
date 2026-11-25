// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CmcError } from "@pryv/cmc";

/**
 * /cmc-accept: an offer that requires a verified email. Pinned here: Approve
 * waits for the proof (Decline does not), the page helps the person get it, and
 * a refusal by the platform keeps the person on the page.
 */

const PLACEHOLDER = "a1b2c3d4e5f6g7h8i9j0@pryv.io";

const net = vi.hoisted(() => ({
  calls: [] as string[],
  updates: [] as unknown[],
  account: {} as unknown,
  update: (async () => ({})) as (update: Record<string, unknown>) => Promise<unknown>,
  features: {} as Record<string, unknown>,
}));
vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      service = { info: async () => ({ features: { emailVerification: net.features } }) };
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        this.endpoint = apiEndpoint;
      }
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
      async apiOne(method: string, params: { update?: Record<string, unknown> }) {
        net.calls.push(this.apiEndpoint + " " + method);
        if (method === "account.get") return net.account;
        net.updates.push(params.update);
        return net.update(params.update!);
      }
    },
  },
}));

const cmcMock = vi.hoisted(() => ({ readOffer: vi.fn(), acceptInvite: vi.fn(), refuseInvite: vi.fn() }));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

import CmcApprove from "./CmcApprove";
import { SessionProvider } from "../lib/session";

const ALICE = "https://tok@alice.core.test/";
const entry = (value: string, primary: boolean, method: string | null, status = "verified") => ({
  value, primary, status, verifiedAt: null, verificationMethod: method,
});
const account = (...emails: Array<ReturnType<typeof entry>>) => ({ email: emails.find((e) => e.primary)?.value, emails });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/cmc-accept?capabilityUrl=https%3A%2F%2Fcap%40requester.test%2F&scopeStreamId=s1"]}>
      <SessionProvider>
        <CmcApprove />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function offer(extra: Record<string, unknown>) {
  cmcMock.readOffer.mockResolvedValue({
    requester: { username: "study", host: "requester.test" },
    requestedPermissions: [{ streamId: ":system:email", level: "read", defaultName: "Email" }],
    mode: "single-use",
    ...extra,
  });
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
/** Give the page the focus back until `check` holds (the listener joins an instant after the waiting text shows). */
const focusUntil = (check: () => void) =>
  waitFor(() => {
    fireEvent(window, new Event("focus"));
    check();
  });
const reads = () => net.calls.filter((c) => c.endsWith("account.get")).length;

describe("/cmc-accept, an offer requiring a verified email", () => {
  const opener = { postMessage: vi.fn() };
  beforeEach(() => {
    net.calls = [];
    net.updates = [];
    net.features = { atRegistration: false, onAccount: true };
    net.account = account(entry("alice@example.com", true, "registration"));
    net.update = async () => net.account;
    for (const fn of Object.values(cmcMock)) fn.mockReset();
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "ev-1" });
    offer({ requireVerifiedEmail: true });
    localStorage.clear();
    localStorage.setItem("pryv.session.apiEndpoint", ALICE);
    localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
    opener.postMessage.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: null });
  });

  it("[RVEP] Approve disabled until the address is proved, Decline enabled throughout", async () => {
    renderPage();
    const notice = await screen.findByTestId("verified-email");
    expect(notice.textContent).toContain("study@requester.test requires a verified email address on this account.");
    expect(notice.textContent).toContain("alice@example.com is not verified yet");
    expect(screen.queryByTestId("missing-email")).toBeNull();
    await waitFor(() => expect(button("Decline").disabled).toBe(false));
    expect(button("Approve").disabled).toBe(true);
    fireEvent.click(button("Send the verification email"));
    await screen.findByText("Open the link we sent to alice@example.com. This page updates by itself.");
    expect(net.updates).toEqual([{ emails: { resend: ["alice@example.com"] } }]);
    expect(button("Approve").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(false);
    // Verified on another device; this page gets the focus back.
    net.account = account(entry("alice@example.com", true, "email-link"));
    await focusUntil(() => screen.getByText("The email address alice@example.com is verified."));
    expect(button("Decline").disabled).toBe(false);
    expect(button("Approve").disabled).toBe(false);
    fireEvent.click(button("Approve"));
    await waitFor(() => expect(cmcMock.acceptInvite).toHaveBeenCalledTimes(1));
  });

  it("acting for a managed account: the notice names it and says whose address counts", async () => {
    localStorage.setItem("pryv.session.parent.apiEndpoint", "https://tok@parent.core.test/");
    localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "alice", parentUsername: "parent" }));
    renderPage();
    const notice = await screen.findByTestId("verified-email");
    expect(notice.textContent).toContain("on the account alice: one of its own, yours does not count.");
  });

  it("no address: added on the page, and an address held by another account is said on the field", async () => {
    net.account = account(entry(PLACEHOLDER, true, "registration"));
    net.update = async () => {
      throw Object.assign(new Error("API error"), { innerObject: { id: "item-already-exists", message: "taken" } });
    };
    renderPage();
    const form = await screen.findByTestId("verified-email-form");
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "bob@example.com" } });
    fireEvent.submit(form);
    await screen.findByText("This address is already used by another account.");
    const input = within(screen.getByTestId("verified-email-form")).getByLabelText("Email address") as HTMLInputElement;
    expect(input.value).toBe("bob@example.com");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(net.updates).toEqual([{ emails: { add: ["bob@example.com"] } }]);
    net.update = async () => net.account;
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.submit(screen.getByTestId("verified-email-form"));
    await screen.findByText("Open the link we sent to alice@example.com. This page updates by itself.");
    expect(button("Approve").disabled).toBe(true);
    fireEvent.click(button("Use another address"));
    await screen.findByTestId("verified-email-form");
  });

  it("[RVQ4] a resend refused for now: the time shown, the button disabled", async () => {
    net.update = async () => {
      throw Object.assign(new Error("API error"), {
        innerObject: { id: "invalid-operation", message: "Please wait", data: { retryAfterSeconds: 120 } },
      });
    };
    renderPage();
    await screen.findByTestId("verified-email");
    fireEvent.click(button("Send the verification email"));
    await screen.findByText(/The next verification email to alice@example.com can be sent from .*\d/);
    expect(button("Send again").disabled).toBe(true);
  });

  it("[RVQ6] a platform without verification mail: said, no button, Approve stays disabled", async () => {
    net.features = { atRegistration: false, onAccount: false };
    renderPage();
    const notice = await screen.findByTestId("verified-email");
    expect(notice.textContent).toContain("This platform does not send verification emails");
    expect(within(notice).queryByRole("button")).toBeNull();
    await waitFor(() => expect(button("Decline").disabled).toBe(false));
    expect(button("Approve").disabled).toBe(true);
  });

  it("[RVQ7] an offer that only reads the address, where registration asks for a proof: the form adds the address", async () => {
    offer({});
    net.features = { atRegistration: true, onAccount: true };
    net.account = account(entry(PLACEHOLDER, true, "registration"));
    net.update = async () => account(entry(PLACEHOLDER, true, "registration"), entry("alice@example.com", false, null, "pending"));
    renderPage();
    const form = await screen.findByTestId("missing-email-form");
    expect(button("Approve").disabled).toBe(false);
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "alice@example.com" } });
    fireEvent.submit(form);
    await screen.findByText("Open the link we sent to alice@example.com. This page updates by itself.");
    expect(net.updates).toEqual([{ emails: { add: ["alice@example.com"] } }]);
    // Not required: approving does not wait for the proof.
    expect(button("Approve").disabled).toBe(false);
    net.account = account(entry(PLACEHOLDER, true, "registration"), entry("alice@example.com", false, "email-link"));
    net.update = async () => (net.account = account(entry("alice@example.com", true, "email-link")));
    await focusUntil(() => screen.getByText("alice@example.com is now this account's email address."));
    expect(net.updates.slice(1)).toEqual([{ emails: { setPrimary: "alice@example.com" } }, { emails: { remove: [PLACEHOLDER] } }]);
  });

  it("[RVQB] an offer that only reads the address, elsewhere: account.update { email } as before", async () => {
    offer({});
    net.account = account(entry(PLACEHOLDER, true, "registration"));
    net.update = async () => ({ email: "alice@example.com" });
    renderPage();
    const form = await screen.findByTestId("missing-email-form");
    fireEvent.change(within(form).getByLabelText("Email address"), { target: { value: "alice@example.com" } });
    fireEvent.submit(form);
    await screen.findByText("alice@example.com is now this account's email address.");
    expect(net.updates).toEqual([{ email: "alice@example.com" }]);
    expect(screen.queryByTestId("verified-email")).toBeNull();
  });

  it("[RVQ9] refused by the platform: its own message, the account read again, the proof asked for again", async () => {
    net.account = account(entry("alice@example.com", true, "email-link"));
    cmcMock.acceptInvite.mockRejectedValue(new CmcError("CMC accept failed", "cmc-verified-email-required"));
    renderPage();
    await screen.findByText("The email address alice@example.com is verified.");
    await waitFor(() => expect(button("Approve").disabled).toBe(false));
    expect(reads()).toBe(1);
    // The primary address changed meanwhile.
    net.account = account(entry("new@example.com", true, "registration"), entry("alice@example.com", false, "email-link"));
    fireEvent.click(button("Approve"));
    await screen.findByText(/This request requires a verified email address on the account that approves it\./);
    await screen.findByText("The email address new@example.com is not verified yet.");
    expect(reads()).toBe(2);
    expect(button("Approve").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(false);
    // The address the person left is not made primary again behind their back.
    expect(net.updates).toEqual([]);
  });

  it("[RVQF] refused by the platform, in a pop-up: the opener is told nothing, also when the offer as read did not say so", async () => {
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: opener });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    offer({});
    cmcMock.acceptInvite.mockRejectedValue(new CmcError("CMC accept failed", "cmc-verified-email-required"));
    renderPage();
    await screen.findByTestId("cmc-requester");
    await waitFor(() => expect(button("Approve").disabled).toBe(false));
    expect(screen.queryByTestId("verified-email")).toBeNull();
    fireEvent.click(button("Approve"));
    await screen.findByText(/This request requires a verified email address on the account that approves it\./);
    await screen.findByText("The email address alice@example.com is not verified yet.");
    expect(button("Approve").disabled).toBe(true);
    expect(opener.postMessage).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    // Verified, then approved: the one outcome the opener gets.
    fireEvent.click(button("Send the verification email"));
    await screen.findByText(/Open the link we sent to/);
    net.account = account(entry("alice@example.com", true, "email-link"));
    await focusUntil(() => expect(button("Approve").disabled).toBe(false));
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "ev-1" });
    fireEvent.click(button("Approve"));
    await screen.findByText("Request approved");
    expect(opener.postMessage).toHaveBeenCalledTimes(1);
    expect(opener.postMessage.mock.calls[0][0]).toEqual({ type: "cmc-accept-result", ok: true, acceptEventId: "ev-1" });
  });
});
