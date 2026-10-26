// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

/**
 * [AARP] A completed sign-in that carries `returnURL` leaves the app as the
 * operator's return policy says, like the other hand-offs: this app's origin
 * and the trusted origins are followed; any other origin with `confirm` lands
 * on the account with a link showing the host (nothing navigates by itself);
 * with `stay` it lands on the account with a notice. Both for a sign-in that
 * continues at once and for one resumed after the sign-in gate's page.
 */

const gate = vi.hoisted(() => ({ pendingAccountActs: vi.fn() }));
vi.mock("../extensions/signInGate", () => gate);
const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("./returnTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./returnTarget")>()),
  navigateTo: nav.navigateTo,
}));
vi.mock("./useSession", () => ({
  useSession: () => ({ connection: { api: vi.fn().mockResolvedValue([{}]) }, setConnection: vi.fn() }),
}));
vi.mock("../accountTabs", () => ({
  ACCOUNT_TABS: [{ path: "profile", label: "Profile", element: <p>profile page</p> }],
  EXTRA_ROUTES: [],
}));

import { continueSignedIn, resumeAfterAccountActs, signInReturnOutcome } from "./accountActsGate";
import { _setDeployedSettingsForTest, parseDeployedSettings, type ReturnAction } from "./deployedSettings";
import type { PryvConnection } from "./session";
import type { SignedInTarget } from "./signInCompletion";
import AccountLayout from "../routes/account/AccountLayout";

const conn = { endpoint: "https://alice.core.test/" } as unknown as PryvConnection;
const RESUME_KEY = "pryv.accountActs.resume";
const TRUSTED = "https://app.example.org";

function policy(otherOrigins: ReturnAction) {
  _setDeployedSettingsForTest(parseDeployedSettings({ returnPolicy: { trustedOrigins: [TRUSTED], otherOrigins } }));
}

function external(href: string): SignedInTarget {
  return { kind: "external", href, stayPath: "/account/profile?pryvServiceInfoUrl=si" };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function Start({ run }: { run: (navigate: NavigateFunction) => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    run(navigate);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p>signing in</p>;
}

/** A sign-in page that finishes with `run`, and the account pages it may land on. */
function renderFlow(run: (navigate: NavigateFunction) => void) {
  render(
    <MemoryRouter initialEntries={["/signin"]}>
      <Routes>
        <Route path="/signin" element={<Start run={run} />} />
        <Route path="/account" element={<AccountLayout />}>
          <Route path="profile" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const ways: Array<[string, (target: SignedInTarget) => (navigate: NavigateFunction) => void]> = [
  ["continueSignedIn", (target) => (navigate) => void continueSignedIn(conn, target, navigate)],
  [
    "resumeAfterAccountActs",
    (target) => {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ target }));
      return (navigate) => resumeAfterAccountActs(navigate);
    },
  ],
];

beforeEach(() => {
  gate.pendingAccountActs.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  _setDeployedSettingsForTest(null);
  nav.navigateTo.mockReset();
  gate.pendingAccountActs.mockReset();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe.each(ways)("[AARP] returnURL after sign-in under the return policy (%s)", (_name, way) => {
  it("[AAR1] a trusted origin is followed", async () => {
    policy("stay");
    renderFlow(way(external(`${TRUSTED}/cb?state=s`)));
    await vi.waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith(`${TRUSTED}/cb?state=s`));
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("[AAR2] this app's own origin is followed", async () => {
    policy("stay");
    const own = `${window.location.origin}/done?state=s`;
    renderFlow(way(external(own)));
    await vi.waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith(own));
  });

  it("[AAR3] stay: the user stays on the account, with a notice", async () => {
    policy("stay");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    renderFlow(way(external("https://anywhere.example/cb?state=s")));
    expect((await screen.findByTestId("where")).textContent).toBe("/account/profile?pryvServiceInfoUrl=si");
    expect(screen.getByTestId("return-refused").textContent).toBe(
      "You are signed in. This page does not send you on to the address in the sign-in link: go back to your app yourself.",
    );
    expect(screen.queryByTestId("return-link")).toBeNull();
    expect(nav.navigateTo).not.toHaveBeenCalled();
  });

  it("[AAR4] confirm: the account shows a link with the host, nothing navigates by itself", async () => {
    policy("confirm");
    renderFlow(way(external("https://anywhere.example/cb?state=s")));
    const link = await screen.findByTestId("return-link");
    expect(link.textContent).toBe("Return to anywhere.example");
    expect(link.getAttribute("href")).toBe("https://anywhere.example/cb?state=s");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getByTestId("where").textContent).toBe("/account/profile?pryvServiceInfoUrl=si");
    expect(nav.navigateTo).not.toHaveBeenCalled();
  });

  it("[AAR5] no policy: any http(s) origin is followed, as before", async () => {
    renderFlow(way(external("https://anywhere.example/cb")));
    await vi.waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://anywhere.example/cb"));
  });
});

describe("[AARP] the notice's router state", () => {
  it("[AAR6] only a valid outcome is shown, with the link's own host", () => {
    expect(signInReturnOutcome({ signInReturn: { kind: "stay" } })).toEqual({ kind: "stay" });
    expect(
      signInReturnOutcome({ signInReturn: { kind: "confirm", href: "https://a.example/x", host: "b.example" } }),
    ).toEqual({ kind: "confirm", href: "https://a.example/x", host: "a.example" });
    expect(signInReturnOutcome({ signInReturn: { kind: "confirm", href: "javascript:alert(1)" } })).toBeNull();
    expect(signInReturnOutcome({ signInReturn: { kind: "follow", href: "https://a.example/" } })).toBeNull();
    expect(signInReturnOutcome({ registeredAs: "alice" })).toBeNull();
    expect(signInReturnOutcome(null)).toBeNull();
  });

  it("[AAR7] a stay page that is not a path on this app falls back to the profile", async () => {
    policy("stay");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const target: SignedInTarget = { kind: "external", href: "https://anywhere.example/", stayPath: "//evil.example/x" };
    renderFlow((navigate) => void continueSignedIn(conn, target, navigate));
    expect((await screen.findByTestId("where")).textContent).toBe("/account/profile");
  });
});
