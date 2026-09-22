// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [SSLR] The third-party sign-in landing page, driven through its wire seams.
 *
 * What the lib-level tests cannot see is pinned here: that the restored return
 * context actually decides where the user ends up, and — the property that is
 * new and load-bearing — that the one-time sign-in key is always redeemed
 * against the core named by THIS page's query. A crafted start link that smuggles
 * a `pryvServiceInfoUrl` into the return context must never be able to point the
 * redemption at an attacker's service, which is where the session token would go.
 */

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

const seams = vi.hoisted(() => ({
  retrieve: vi.fn(),
  apiEndpointFor: vi.fn(),
  getService: vi.fn(),
}));

vi.mock("pryv", () => ({
  default: {
    SharedSecrets: { retrieve: seams.retrieve },
    Service: class {},
    Connection: class {
      endpoint: string;
      constructor(apiEndpoint: string) {
        this.endpoint = apiEndpoint;
      }
    },
  },
}));

vi.mock("../lib/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/service")>()),
  getService: seams.getService,
}));

import SsoLanding from "./SsoLanding";
import { SessionProvider } from "../lib/session";

const REAL_SI = "https://real.example/reg/service/info";
const EVIL_SI = "https://evil.example/reg/service/info";
const LANDING_SEARCH = `?pryvServiceInfoUrl=${encodeURIComponent(REAL_SI)}`;
const ENDPOINT = "https://alice.real.example";

let href: string;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;

/** Put a callback fragment on the address bar without a real navigation. */
function setHash(hash: string, landingSearch: string = LANDING_SEARCH) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hash,
      pathname: "/sso-signin",
      search: landingSearch,
      set href(v: string) {
        href = v;
      },
      get href() {
        return href;
      },
    },
  });
}

function renderLanding(landingSearch: string = LANDING_SEARCH) {
  return render(
    <MemoryRouter initialEntries={[`/sso-signin${landingSearch}`]}>
      <SessionProvider>
        <SsoLanding />
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  href = "";
  sessionStorage.clear();
  localStorage.clear();
  navigateMock.mockReset();
  seams.retrieve.mockReset();
  seams.apiEndpointFor.mockReset();
  seams.getService.mockReset();

  seams.apiEndpointFor.mockResolvedValue(ENDPOINT);
  seams.getService.mockImplementation(() => ({ apiEndpointFor: seams.apiEndpointFor }));
  seams.retrieve.mockResolvedValue({ secret: { token: "tk", apiEndpoint: ENDPOINT } });
  replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("[SSLR] SSO landing", () => {
  it("[SSLR1] a restored returnURL completes the auth flow instead of landing on the profile", async () => {
    setHash(
      "#ssoStatus=login&ssoUser=alice&ssoKey=k1" +
        "&ssoReturn=" + encodeURIComponent("returnURL=https%3A%2F%2Fapp.example%2Fcb&state=csrf-1"),
    );
    renderLanding();

    await waitFor(() => expect(href).not.toBe(""));
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://app.example/cb");
    expect(url.searchParams.get("state")).toBe("csrf-1");
    expect(url.searchParams.get("pryvApiEndpoint")).toBe(ENDPOINT);
    expect(href).not.toContain("tk");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("[SSLR2] a hand-off returns to its page with the capability link from this tab", async () => {
    // The capability URL is a bearer: it rides the tab, never the core.
    sessionStorage.setItem(
      "pryv.sso.return",
      JSON.stringify({
        h: "n1",
        search: `?next=%2Fcmc-accept&capabilityUrl=${encodeURIComponent("https://core/cap-secret")}&mode=popup`,
        at: Date.now(),
      }),
    );
    setHash(
      "#ssoStatus=login&ssoUser=alice&ssoKey=k1" +
        "&ssoReturn=" + encodeURIComponent("next=%2Fcmc-accept&h=n1"),
    );
    renderLanding();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const path = navigateMock.mock.calls[0][0] as string;
    expect(path.startsWith("/cmc-accept?")).toBe(true);
    const q = new URLSearchParams(path.slice(path.indexOf("?")));
    expect(q.get("capabilityUrl")).toBe("https://core/cap-secret");
    expect(q.get("mode")).toBe("popup");
    expect(q.get("pryvServiceInfoUrl")).toBe(REAL_SI);
  });

  it("[SSLR3] the MFA continuation carries the restored query and the real service-info URL", async () => {
    setHash(
      "#ssoStatus=mfa&ssoUser=alice&ssoMfaToken=mt&ssoMfaMethod=totp" +
        "&ssoReturn=" + encodeURIComponent(
          `returnURL=https%3A%2F%2Fapp.example%2Fcb&pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`,
        ),
    );
    renderLanding();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const [path, opts] = navigateMock.mock.calls[0] as [string, { state: { search: string } }];
    expect(path).toBe("/mfa-challenge");
    const q = new URLSearchParams(opts.state.search);
    expect(q.get("returnURL")).toBe("https://app.example/cb");
    expect(q.get("pryvServiceInfoUrl")).toBe(REAL_SI);
    expect(opts.state.search).not.toContain("evil.example");
  });

  it("[SSLR3B] a landing URL without a service-info URL does not acquire one from the return context", async () => {
    // The MFA continuation resolves its service from the query it is handed,
    // so if a crafted return context could supply that URL when the landing
    // page carries none, the second-factor code and mfaToken would be posted
    // to whatever service the attacker named.
    setHash(
      "#ssoStatus=mfa&ssoUser=alice&ssoMfaToken=mt&ssoMfaMethod=totp" +
        "&ssoReturn=" + encodeURIComponent(
          `state=s&pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`,
        ),
      "",
    );
    renderLanding("");

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const [, opts] = navigateMock.mock.calls[0] as [string, { state: { search: string } }];
    expect(new URLSearchParams(opts.state.search).get("pryvServiceInfoUrl")).toBeNull();
    expect(opts.state.search).not.toContain("evil.example");
  });

  it("[SSLR4] after a refusal, the way back to sign-in keeps the flow the user started", async () => {
    setHash(
      "#ssoError=no-account&ssoReturn=" +
        encodeURIComponent("returnURL=https%3A%2F%2Fapp.example%2Fcb&state=csrf-1"),
    );
    renderLanding();

    const back = await screen.findByRole("button", { name: /back to sign-in/i });
    back.click();
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    const target = navigateMock.mock.calls[0][0] as string;
    expect(target.startsWith("/signin?")).toBe(true);
    const q = new URLSearchParams(target.slice(target.indexOf("?")));
    expect(q.get("returnURL")).toBe("https://app.example/cb");
    expect(q.get("state")).toBe("csrf-1");
  });

  it("[SSLR5] a returnURL that could execute in this origin is dropped, not navigated to", async () => {
    setHash(
      "#ssoStatus=login&ssoUser=alice&ssoKey=k1&ssoReturn=" +
        encodeURIComponent(`returnURL=${encodeURIComponent("javascript:alert(1)")}`),
    );
    renderLanding();

    // Falls through to the profile rather than throwing after the session is set.
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock.mock.calls[0][0]).toBe(
      "/account/profile?pryvServiceInfoUrl=" + encodeURIComponent(REAL_SI),
    );
    expect(href).toBe("");
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });

  it("[SSLR6] the one-time key is redeemed against this page's core, never one named in the return context", async () => {
    setHash(
      "#ssoStatus=login&ssoUser=alice&ssoKey=k1&ssoReturn=" +
        encodeURIComponent(`pryvServiceInfoUrl=${encodeURIComponent(EVIL_SI)}`),
    );
    renderLanding();

    await waitFor(() => expect(seams.retrieve).toHaveBeenCalled());
    // getService resolves the core from the landing page's own query.
    for (const call of seams.getService.mock.calls) {
      expect(String(call[0] ?? "")).not.toContain("evil.example");
      expect(String(call[0] ?? "")).toContain(encodeURIComponent(REAL_SI));
    }
    expect(seams.retrieve.mock.calls[0][0]).toBe(ENDPOINT);
  });

  it("[SSLR7] the fragment is stripped before the one-time key is redeemed", async () => {
    let strippedBeforeRedeem = false;
    seams.retrieve.mockImplementation(async () => {
      strippedBeforeRedeem = replaceStateSpy.mock.calls.length > 0;
      return { secret: { token: "tk", apiEndpoint: ENDPOINT } };
    });
    setHash("#ssoStatus=login&ssoUser=alice&ssoKey=k1&ssoReturn=state%3Ds");
    renderLanding();

    await waitFor(() => expect(seams.retrieve).toHaveBeenCalled());
    expect(strippedBeforeRedeem).toBe(true);
  });
});
