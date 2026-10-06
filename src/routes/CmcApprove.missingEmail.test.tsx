// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [CMRE] /cmc-accept: an offer that reads the account's email, on an account
 * with no address someone receives (the placeholder invented at
 * registration). Pinned here: the block says so and names the requester;
 * Approve stays available; the address can be added in place; when the account
 * cannot be read nothing is said.
 */

const PLACEHOLDER = "a1b2c3d4e5f6g7h8i9j0@pryv.io";

const net = vi.hoisted(() => ({
  /** Every call, as "<apiEndpoint> <method>", and the handler answering it. */
  calls: [] as string[],
  answer: (() => ({})) as (endpoint: string, method: string, params: unknown) => unknown,
}));

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
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
      async api(calls: Array<{ method: string; params: unknown }>) {
        const out = [];
        for (const c of calls) {
          net.calls.push(this.apiEndpoint + " " + c.method);
          out.push(await net.answer(this.apiEndpoint, c.method, c.params));
        }
        return out;
      }
    },
  },
}));

const cmcMock = vi.hoisted(() => ({ readOffer: vi.fn(), acceptInvite: vi.fn() }));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  return { ...actual, cmc: { ...actual.cmc, ...cmcMock } };
});

import CmcApprove from "./CmcApprove";
import { SessionProvider } from "../lib/session";

const READS_EMAIL = [
  { streamId: "diary", level: "read" },
  { streamId: ":system:email", level: "read", defaultName: "Email" },
];

function signedIn(api = "https://tok@alice.core.test/") {
  localStorage.setItem("pryv.session.apiEndpoint", api);
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/reg/service/info");
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/cmc-accept?capabilityUrl=https%3A%2F%2Fcap%40requester.test%2F&scopeStreamId=s1"]}>
      <SessionProvider>
        <CmcApprove />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function offerReading(permissions: unknown[]) {
  cmcMock.readOffer.mockResolvedValue({
    requester: { username: "mallory", host: "requester.test" },
    requestedPermissions: permissions,
    consent: { en: "I agree that the study contacts me at this address." },
    mode: "single-use",
  });
}

const approveButton = () => screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;

describe("[CMRE] /cmc-accept missing email", () => {
  beforeEach(() => {
    net.calls = [];
    net.answer = (_e, method) => (method === "account.get" ? { account: { username: "alice", email: PLACEHOLDER } } : {});
    cmcMock.readOffer.mockReset();
    cmcMock.acceptInvite.mockReset();
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "ev-1" });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("[CME1] the account holds the placeholder: the block says so, names the requester, Approve stays", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    renderPage();
    const notice = await screen.findByTestId("missing-email");
    expect(notice.textContent).toContain("This account has no email address: add one so mallory@requester.test can reach you.");
    expect(within(notice).getByLabelText("Email address")).toBeTruthy();
    expect(approveButton().disabled).toBe(false);
    expect(net.calls).toEqual(["https://tok@alice.core.test/ account.get"]);
  });

  it("[CME2] the account has a real address: nothing is said", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    net.answer = (_e, method) => (method === "account.get" ? { account: { email: "alice@example.com" } } : {});
    renderPage();
    await screen.findByTestId("cmc-requester");
    await waitFor(() => expect(net.calls).toContain("https://tok@alice.core.test/ account.get"));
    expect(screen.queryByTestId("missing-email")).toBeNull();
    expect(approveButton().disabled).toBe(false);
  });

  it("[CME3] an offer that does not read the email: the account is not read", async () => {
    signedIn();
    offerReading([{ streamId: "diary", level: "read" }, { streamId: "*", level: "manage" }]);
    renderPage();
    await screen.findByTestId("cmc-requester");
    await new Promise((r) => setTimeout(r, 30));
    expect(net.calls).toEqual([]);
    expect(screen.queryByTestId("missing-email")).toBeNull();
  });

  it("[CME4] an address added in place: sent as typed, said, Approve waits for it", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    let release: (v: unknown) => void = () => {};
    const updates: unknown[] = [];
    net.answer = (_e, method, params) => {
      if (method === "account.get") return { account: { email: PLACEHOLDER } };
      updates.push(params);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    renderPage();
    const notice = await screen.findByTestId("missing-email");
    fireEvent.change(within(notice).getByLabelText("Email address"), { target: { value: "alice@example.com" } });
    fireEvent.submit(within(notice).getByTestId("missing-email-form"));
    await waitFor(() => expect(updates).toEqual([{ update: { email: "alice@example.com" } }]));
    expect(approveButton().disabled).toBe(true);
    release({ account: { email: "alice@example.com" } });
    await screen.findByText("alice@example.com is now this account's email address.");
    expect(approveButton().disabled).toBe(false);
  });

  it("[CME5] an address already taken: said, the typed value kept, Approve still accepts", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    net.answer = (_e, method) =>
      method === "account.get"
        ? { account: { email: PLACEHOLDER } }
        : { error: { id: "item-already-exists", message: "Item already exists", data: { email: "bob@example.com" } } };
    renderPage();
    const notice = await screen.findByTestId("missing-email");
    const field = within(notice).getByLabelText("Email address") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "bob@example.com" } });
    fireEvent.submit(within(notice).getByTestId("missing-email-form"));
    const reason = await screen.findByText("This address is already used by another account.");
    const input = within(screen.getByTestId("missing-email")).getByLabelText("Email address") as HTMLInputElement;
    expect(input.value).toBe("bob@example.com");
    // The reason is tied to the field.
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy != null && document.getElementById(describedBy)?.contains(reason)).toBe(true);
    expect(approveButton().disabled).toBe(false);
    approveButton().click();
    await waitFor(() => expect(cmcMock.acceptInvite).toHaveBeenCalledTimes(1));
  });

  it("[CME8] the added notice shows the address the platform now holds, not the one typed", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    net.answer = (_e, method) =>
      method === "account.get" ? { account: { email: PLACEHOLDER } } : { account: { email: "alice@example.org" } };
    renderPage();
    const notice = await screen.findByTestId("missing-email");
    fireEvent.change(within(notice).getByLabelText("Email address"), { target: { value: "Alice@Example.org" } });
    fireEvent.submit(within(notice).getByTestId("missing-email-form"));
    await screen.findByText("alice@example.org is now this account's email address.");
    expect(screen.queryByText(/Alice@Example\.org/)).toBeNull();
  });

  it("[CME6] the account cannot be read: nothing said, a warning without the endpoint, Approve available", async () => {
    signedIn();
    offerReading(READS_EMAIL);
    net.answer = () => {
      throw new Error("could not reach https://tok@alice.core.test/");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderPage();
    await screen.findByTestId("cmc-requester");
    await waitFor(() => expect(warn).toHaveBeenCalled());
    const logged = warn.mock.calls.flat().map(String).join(" ");
    warn.mockRestore();
    expect(logged).toContain("could not read the account's email");
    expect(logged).not.toContain("tok@");
    expect(screen.queryByTestId("missing-email")).toBeNull();
    expect(approveButton().disabled).toBe(false);
  });

  it("[CME7] acting for a managed account: the notice names it", async () => {
    signedIn("https://kid-pat@kiddo.core.test/");
    localStorage.setItem("pryv.session.parent.apiEndpoint", "https://tok@alice.core.test/");
    localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username: "kiddo", parentUsername: "alice" }));
    offerReading(READS_EMAIL);
    renderPage();
    const notice = await screen.findByTestId("missing-email");
    expect(notice.textContent).toContain("kiddo has no email address: add one so mallory@requester.test can reach them.");
    // Read on the managed account, with its session.
    expect(net.calls).toEqual(["https://kid-pat@kiddo.core.test/ account.get"]);
  });
});
