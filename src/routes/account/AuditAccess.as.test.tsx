// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { DelegationError, errorIds } from "@pryv/delegation";

/**
 * [AXAS] The access details page opened from a link naming a managed account
 * (`?as=<username>`). Pinned here: nothing switches without the click; the
 * account is looked up among the ones the signed-in person actively manages,
 * with their OWN session (the parent's while acting for another account);
 * unknown, unmanaged and stale read the same; a value that is not a username
 * is never echoed; the parameter leaves the address at once; after Open the
 * page shows the access as the managed account.
 */

const net = vi.hoisted(() => ({
  /** Every API call, as "<endpoint> <method>". */
  calls: [] as string[],
  /** The accesses each account holds, by endpoint without token. */
  accesses: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        const url = new URL(apiEndpoint);
        url.username = "";
        this.endpoint = url.toString();
      }
      async username() {
        return new URL(this.apiEndpoint).hostname.split(".")[0];
      }
      async accessInfo() {
        return { id: "self-" + new URL(this.apiEndpoint).hostname.split(".")[0] };
      }
      async api(calls: Array<{ method: string }>) {
        return calls.map((c) => {
          net.calls.push(this.endpoint + " " + c.method);
          if (c.method === "accesses.get") return { accesses: net.accesses[this.endpoint] ?? [] };
          if (c.method === "events.get") return { events: [] };
          return { streams: [] };
        });
      }
    },
  },
}));

const deleg = vi.hoisted(() => ({
  listControlled: vi.fn(),
  openControlled: vi.fn(),
  getToken: vi.fn(),
  /** The connection each delegation client was built on, in order. */
  builtOn: [] as Array<{ apiEndpoint?: string }>,
}));
vi.mock("@pryv/delegation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pryv/delegation")>();
  return {
    ...actual,
    Delegation: {
      fromConnection: (connection: { apiEndpoint?: string }) => {
        deleg.builtOn.push(connection);
        return { listControlled: deleg.listControlled, openControlled: deleg.openControlled, getToken: deleg.getToken };
      },
    },
  };
});

import Pryv from "pryv";
import AuditAccess from "./AuditAccess";
import { SessionProvider } from "../../lib/session";

const PARENT_API = "https://parent-token@parent.core.test/";
const KID = "https://kiddo.core.test/";
const SVC = "https%3A%2F%2Fcore.test%2Fservice%2Finfo";
const active = (username: string, status = "active") => ({
  relId: "r-" + username,
  controlled: { username, hostSlug: "core-b" },
  status,
  requestedAt: 1,
});

function signedIn() {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", PARENT_API);
}

function actingFor(username: string) {
  localStorage.setItem("pryv.session.serviceInfoUrl", "https://core.test/service/info");
  localStorage.setItem("pryv.session.apiEndpoint", "https://" + username + "-pat@" + username + ".core.test/");
  localStorage.setItem("pryv.session.parent.apiEndpoint", PARENT_API);
  localStorage.setItem("pryv.session.actingAs", JSON.stringify({ username, parentUsername: "parent" }));
}

let location = "";
function Probe() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}

function openPage(query: string) {
  render(
    <MemoryRouter initialEntries={["/account/audit-access/acc-1" + query]}>
      <SessionProvider>
        <Routes>
          <Route
            path="/account/audit-access/:accessId"
            element={
              <>
                <AuditAccess />
                <Probe />
              </>
            }
          />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

const accessReads = () => net.calls.filter((c) => c.endsWith(" accesses.get") || c.endsWith(" events.get"));
const stored = () => JSON.parse(localStorage.getItem("pryv.session.actingAs") ?? "null");

describe("[AXAS] open a managed account's access from a link", () => {
  beforeEach(() => {
    net.calls = [];
    net.accesses = { [KID]: [{ id: "acc-1", name: "kid-app", type: "app" }] };
    deleg.listControlled.mockReset();
    deleg.openControlled.mockReset();
    deleg.getToken.mockReset();
    deleg.builtOn = [];
    deleg.listControlled.mockResolvedValue([active("kiddo")]);
    deleg.openControlled.mockImplementation(async (username: string) => new Pryv.Connection("https://" + username + "-pat@" + username + ".core.test/"));
    localStorage.clear();
    location = "";
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("[AXA1] offers to open as the managed account, switches only on the click, then shows its access", async () => {
    signedIn();
    openPage("?as=kiddo&pryvServiceInfoUrl=" + SVC);
    const heading = await screen.findByRole("heading", { name: /^Open as kiddo\?/ });
    // The managed account's core, as on the Delegation page.
    expect(heading.textContent).toContain("core-b");
    // The heading takes the focus.
    await waitFor(() => expect(document.activeElement).toBe(heading));
    // The parameter left the address, the platform stayed.
    expect(location).toBe("/account/audit-access/acc-1?pryvServiceInfoUrl=" + SVC);
    // Nothing of the access was read before the click.
    expect(accessReads()).toEqual([]);
    expect(deleg.openControlled).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Open as kiddo" }).click();
    await screen.findByText("kid-app");
    expect(deleg.openControlled).toHaveBeenCalledTimes(1);
    expect(deleg.openControlled).toHaveBeenCalledWith("kiddo");
    expect(stored()).toEqual({ username: "kiddo", parentUsername: "parent" });
    expect(localStorage.getItem("pryv.session.parent.apiEndpoint")).toBe(PARENT_API);
    expect(location).toBe("/account/audit-access/acc-1?pryvServiceInfoUrl=" + SVC);
    // Read from the managed account's connection only.
    expect(accessReads().every((c) => c.startsWith(KID))).toBe(true);
    expect(screen.queryByText(/This access is not listed anymore/)).toBeNull();
  });

  it("[AXA2] Stay on my account: the own account's page, nothing switched", async () => {
    signedIn();
    openPage("?as=kiddo");
    (await screen.findByRole("button", { name: "Stay on my account" })).click();
    await screen.findByText(/This access is not listed anymore/);
    expect(accessReads().some((c) => c.startsWith("https://parent.core.test/"))).toBe(true);
    expect(deleg.openControlled).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it("[AXA3] an account not managed and a stale one read the same; nothing is minted", async () => {
    const texts: string[] = [];
    for (const [as, list] of [
      ["stranger", [active("kiddo")]],
      ["kiddo", [active("kiddo", "stale")]],
    ] as const) {
      signedIn();
      deleg.listControlled.mockReset();
      deleg.listControlled.mockResolvedValue(list);
      openPage("?as=" + as);
      const notice = await screen.findByText(/you do not actively manage that account/);
      texts.push((notice.textContent ?? "").replace(as, "X"));
      await screen.findByText(/This access is not listed anymore/);
      expect(deleg.listControlled).toHaveBeenCalledTimes(1);
      expect(deleg.openControlled).not.toHaveBeenCalled();
      expect(deleg.getToken).not.toHaveBeenCalled();
      cleanup();
      localStorage.clear();
    }
    expect(texts[0]).toBe(texts[1]);
  });

  it("[AXA4] the signed-in account named: nothing to do, nothing listed", async () => {
    signedIn();
    openPage("?as=parent");
    await screen.findByText(/This access is not listed anymore/);
    expect(screen.queryByRole("heading", { name: /Open as/ })).toBeNull();
    expect(screen.queryByText(/This link/)).toBeNull();
    expect(deleg.listControlled).not.toHaveBeenCalled();
    expect(location).toBe("/account/audit-access/acc-1");
  });

  it("[AXA5] a value that is not a username is ignored and never echoed", async () => {
    signedIn();
    openPage("?as=%3Cb%3Ekid%3C%2Fb%3E");
    await screen.findByText(/names an account that cannot exist/);
    expect(document.querySelector("b")).toBeNull();
    expect(document.body.textContent).not.toContain("<b>");
    expect(document.body.textContent).not.toContain("kiddo</b>");
    expect(deleg.listControlled).not.toHaveBeenCalled();
  });

  it("[AXA6] the managed accounts cannot be listed: said so, the own page, no mint", async () => {
    signedIn();
    deleg.listControlled.mockRejectedValue(new TypeError("Failed to fetch"));
    openPage("?as=kiddo");
    await screen.findByText(/could not be checked/);
    await screen.findByText(/This access is not listed anymore/);
    expect(deleg.openControlled).not.toHaveBeenCalled();
    expect(deleg.getToken).not.toHaveBeenCalled();
  });

  it("[AXA7] while acting for one account, a link for another is resolved and opened from the parent's session", async () => {
    actingFor("kid-a");
    deleg.listControlled.mockResolvedValue([active("kid-a"), active("kid-b")]);
    net.accesses = { ["https://kid-b.core.test/"]: [{ id: "acc-1", name: "kid-b-app", type: "app" }] };
    openPage("?as=kid-b");
    (await screen.findByRole("button", { name: "Open as kid-b" })).click();
    await screen.findByText("kid-b-app");
    expect(deleg.builtOn.length).toBeGreaterThan(0);
    for (const conn of deleg.builtOn) expect(conn.apiEndpoint).toBe(PARENT_API);
    expect(stored()).toEqual({ username: "kid-b", parentUsername: "parent" });
    // The first account to return to is kept.
    expect(localStorage.getItem("pryv.session.parent.apiEndpoint")).toBe(PARENT_API);
  });

  it("[AXA8] Open fails: the reason on the card, nothing switched, Stay still works", async () => {
    signedIn();
    deleg.openControlled.mockRejectedValue(new DelegationError("not active", errorIds.NOT_ACTIVE));
    openPage("?as=kiddo");
    (await screen.findByRole("button", { name: "Open as kiddo" })).click();
    await screen.findByText("This delegation is no longer active.");
    expect(screen.getByRole("heading", { name: /Open as kiddo\?/ })).toBeTruthy();
    expect(stored()).toBeNull();
    screen.getByRole("button", { name: "Stay on my account" }).click();
    await screen.findByText(/This access is not listed anymore/);
  });

  it("[AXA9] already acting for the account named: nothing to do, the page loads as it", async () => {
    actingFor("kiddo");
    openPage("?as=kiddo");
    await screen.findByText("kid-app");
    expect(screen.queryByRole("heading", { name: /Open as/ })).toBeNull();
    expect(screen.queryByText(/This link/)).toBeNull();
    expect(deleg.listControlled).not.toHaveBeenCalled();
  });
});
