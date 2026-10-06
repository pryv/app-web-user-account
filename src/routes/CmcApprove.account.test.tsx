// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

/**
 * [CMRS] /cmc-accept: the account that answers. Nothing in the link binds an
 * open-link invite to a person, so the page names the signed-in account above
 * Approve / Decline with a way to switch, offers neither until that account is
 * known, and, when the calling app names the account it expects (`username=`)
 * and the session is another one, asks to switch account instead.
 */

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
        const name = new URL(this.apiEndpoint).hostname.split(".")[0];
        if (name === "unreachable") throw new Error("network down");
        return name;
      }
      async api() {
        return [{}];
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

const SERVICE_INFO_URL = "https://core.test/reg/service/info";
const CAPABILITY = "https://cap@requester.test/";

function signedIn(api = "https://tok@alice.core.test/") {
  localStorage.setItem("pryv.session.apiEndpoint", api);
  localStorage.setItem("pryv.session.serviceInfoUrl", SERVICE_INFO_URL);
}

/** Stands in for /signin: shows where the page was sent. */
function SignInProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="signin-probe">{pathname + search}</p>;
}

function renderPage(extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ capabilityUrl: CAPABILITY, scopeStreamId: "s1", ...extra });
  render(
    <MemoryRouter initialEntries={[`/cmc-accept?${q.toString()}`]}>
      <SessionProvider>
        <Routes>
          <Route path="/cmc-accept" element={<CmcApprove />} />
          <Route path="/signin" element={<SignInProbe />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

function offer() {
  cmcMock.readOffer.mockResolvedValue({
    requester: { username: "bob", host: "requester.test" },
    requestedPermissions: [{ streamId: "diary", level: "read" }],
    mode: "open",
  });
}

/** The /signin target the page navigated to, as query params. */
async function signInTarget(): Promise<URLSearchParams> {
  const probe = await screen.findByTestId("signin-probe");
  const target = probe.textContent ?? "";
  expect(target.startsWith("/signin?")).toBe(true);
  return new URLSearchParams(target.slice("/signin".length));
}

describe("[CMRS] /cmc-accept names the account that answers", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    cmcMock.readOffer.mockReset();
    cmcMock.acceptInvite.mockReset();
  });

  it("[CMS1] states the signed-in account above Approve, with a way to switch", async () => {
    signedIn();
    offer();
    renderPage();
    const line = await screen.findByTestId("cmc-approving-as");
    expect(line.textContent).toContain("You are approving as alice.");
    expect(line.querySelector("strong")?.textContent).toBe("alice");
    expect(screen.getByRole("button", { name: "Not you? Switch account" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[CMS2] Switch account signs out and returns to the same request after sign-in", async () => {
    signedIn();
    offer();
    renderPage({ mode: "popup", returnUrl: "https://app.test/" });
    fireEvent.click(await screen.findByRole("button", { name: "Not you? Switch account" }));
    const target = await signInTarget();
    expect(target.get("next")).toBe("/cmc-accept");
    expect(target.get("capabilityUrl")).toBe(CAPABILITY);
    expect(target.get("scopeStreamId")).toBe("s1");
    expect(target.get("mode")).toBe("popup");
    expect(target.get("returnUrl")).toBe("https://app.test/");
    // The platform of the session that was signed out is kept for the sign-in.
    expect(target.get("pryvServiceInfoUrl")).toBe(SERVICE_INFO_URL);
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
  });

  it("[CMS3] another account than the one the app expects: asks to switch, offers no Approve", async () => {
    signedIn();
    offer();
    renderPage({ username: "carol" });
    const block = await screen.findByTestId("cmc-switch-account");
    expect(block.textContent).toContain("This request is for carol, but you are signed in as alice.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByTestId("cmc-approving-as")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    const target = await signInTarget();
    // The sign-in form is pre-filled with the expected account.
    expect(target.get("username")).toBe("carol");
    expect(target.get("next")).toBe("/cmc-accept");
    expect(localStorage.getItem("pryv.session.apiEndpoint")).toBeNull();
  });

  it("[CMS4] the expected account, in any case: Approve is offered", async () => {
    signedIn();
    offer();
    renderPage({ username: "Alice" });
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[CMS5] an email hint is not compared with the account", async () => {
    signedIn();
    offer();
    renderPage({ username: "carol@example.test" });
    await screen.findByTestId("cmc-approving-as");
    expect(screen.queryByTestId("cmc-switch-account")).toBeNull();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("[CMS6] the signed-in account cannot be read: no Approve, sign in again instead", async () => {
    signedIn("https://tok@unreachable.core.test/");
    offer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderPage();
    const block = await screen.findByTestId("cmc-switch-account");
    warn.mockRestore();
    expect(block.textContent).toContain("Could not confirm which account is signed in.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("[CMS7] Approve answers with the session the page named", async () => {
    signedIn();
    offer();
    cmcMock.acceptInvite.mockResolvedValue({ acceptEventId: "evt-1" });
    renderPage();
    await screen.findByTestId("cmc-approving-as");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Request approved");
    const [conn] = cmcMock.acceptInvite.mock.calls[0] as [{ apiEndpoint: string }];
    expect(conn.apiEndpoint).toBe("https://tok@alice.core.test/");
  });
});
