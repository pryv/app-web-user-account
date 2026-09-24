// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * The legacy `/auth` consent screen, driven end to end through its wire
 * seams. What is pinned here is the behaviour the lib-level tests cannot
 * see: that a consent form reaches the rendered rows in the right tick
 * state, that only the ticked subset is minted, and that a refused grant
 * takes the just-minted access back out.
 *
 * `accessFlow` (every HTTP touchpoint) and the sign-in component are
 * mocked; everything else is the real component.
 */

const flow = vi.hoisted(() => ({
  loadAccessState: vi.fn(),
  updateAccessState: vi.fn(),
  checkAppAccess: vi.fn(),
  createAppAccess: vi.fn(),
  deleteAppAccess: vi.fn(),
  closeOrRedirect: vi.fn(),
  createHandoffSecret: vi.fn(),
  deriveServiceInfoUrlFromPollUrl: vi.fn(() => "https://core.test/service/info"),
}));

vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
}));

// Sign-in is a whole flow of its own (password, MFA); stand in for it with
// a button that hands back a session, which is all this screen needs.
vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({
    onSignedIn,
    externalError,
    footer,
  }: {
    onSignedIn: (s: { username: string; personalToken: string; endpoint: string }) => void;
    externalError?: string | null;
    footer?: ReactNode;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          void onSignedIn({
            username: "alice",
            personalToken: "personal-token",
            endpoint: "https://alice.core.test/",
          })
        }
      >
        sign-in-stub
      </button>
      {/* The real component renders this; the stub must too, or a message
          raised before the consent panel exists would look swallowed. */}
      {externalError ? <p>{externalError}</p> : null}
      {footer}
    </div>
  ),
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";

const OFFER = [
  { streamId: "diary", level: "read", defaultName: "Journal" },
  { streamId: "weight", level: "read", defaultName: "Weight" },
];

/** A poll state carrying a consent form: diary required, weight opt-in. */
function stateWithConsent() {
  return {
    status: "NEED_SIGNIN",
    requestingAppId: "test-app",
    requestedPermissions: OFFER,
    serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
    consent: {
      allowUserChoice: true,
      permissions: [
        { streamId: "diary", level: "read", defaultName: "Journal", mandatory: true },
        { streamId: "weight", level: "read", defaultName: "Weight", optIn: true },
      ],
    },
  };
}

async function renderAndSignIn(state: Record<string, unknown>) {
  flow.loadAccessState.mockResolvedValue(state);
  flow.checkAppAccess.mockResolvedValue({ checkedPermissions: OFFER });
  render(
    <MemoryRouter initialEntries={["/auth?poll=https://core.test/reg/access/k1"]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  const signIn = await screen.findByText("sign-in-stub");
  signIn.click();
  await screen.findByText(/is requesting permission/);
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll('input[type="checkbox"]'));
}

describe("[AUCP] /auth consent panel", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) if (typeof fn.mockReset === "function") fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    flow.createAppAccess.mockResolvedValue({ id: "acc-new", token: "app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
  });
  afterEach(() => {
    // vitest `globals` is off here, so RTL does not auto-clean between
    // tests and the previous render would still be in the document.
    cleanup();
    vi.unstubAllGlobals();
  });

  it("[AUC1] opens an opt-in entry unticked and a required one locked, and mints only what is ticked", async () => {
    await renderAndSignIn(stateWithConsent());

    const boxes = checkboxes();
    expect(boxes).toHaveLength(2);
    // diary is required: ticked and not the user's to change.
    expect(boxes[0].checked).toBe(true);
    expect(boxes[0].disabled).toBe(true);
    // weight is opt-in: offered UNticked, and the user may tick it.
    expect(boxes[1].checked).toBe(false);
    expect(boxes[1].disabled).toBe(false);
    expect(screen.getByText(/required by this app/)).toBeTruthy();

    screen.getByRole("button", { name: /accept/i }).click();

    await waitFor(() => expect(flow.createAppAccess).toHaveBeenCalled());
    const minted = flow.createAppAccess.mock.calls[0][2];
    // Only the required entry: the opt-in one was never ticked. And no
    // consent annotation travels on the mint.
    expect(minted.permissions).toEqual([
      { streamId: "diary", level: "read", defaultName: "Journal" },
    ]);
  });

  it("[AUC6] a shared-secret request hands the credential off: the page creates the secret and posts the key, never the token", async () => {
    flow.createHandoffSecret.mockResolvedValue("evt.the-key");
    // A plain (no-consent) request that asked for shared-secret delivery.
    await renderAndSignIn({
      status: "NEED_SIGNIN",
      requestingAppId: "test-app",
      requestedPermissions: OFFER,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
      credentialHandoff: "shared-secret",
    });

    screen.getByRole("button", { name: /accept/i }).click();

    await waitFor(() => expect(flow.createHandoffSecret).toHaveBeenCalled());
    const [endpointArg, creatorTokenArg, params] = flow.createHandoffSecret.mock.calls[0];
    // Created on the signed-in account endpoint, with the personal token (from
    // the caller's scope, not stale React state), carrying the app token.
    expect(endpointArg).toBe("https://alice.core.test/");
    expect(creatorTokenArg).toBe("personal-token");
    expect(params.secret.token).toBe("app-token");

    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const posted = flow.updateAccessState.mock.calls[0][1];
    // Shape H: the one-time key, and NO token on the wire to the entry core.
    expect(posted.handoff).toEqual({ type: "shared-secret", key: "evt.the-key" });
    expect(posted.token).toBeUndefined();
  });

  it("[AUC7] a shared-secret request falls back to inline when the secret cannot be created", async () => {
    flow.createHandoffSecret.mockRejectedValue(new Error("create shared secret failed (403)"));
    await renderAndSignIn({
      status: "NEED_SIGNIN",
      requestingAppId: "test-app",
      requestedPermissions: OFFER,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
      credentialHandoff: "shared-secret",
    });

    screen.getByRole("button", { name: /accept/i }).click();

    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalled());
    const posted = flow.updateAccessState.mock.calls[0][1];
    // Fallback: inline token, no hand-off.
    expect(posted.token).toBe("app-token");
    expect(posted.handoff).toBeUndefined();
  });

  it("[AUC8] the already-authorized reuse path also hands the credential off (not a stale-null token)", async () => {
    // Regression: finalizeAccepted must use the personal token from the
    // caller's scope. The sign-in entry points set React state and call
    // through in the same tick, so reading `personalToken` from state here
    // would be null and silently drop the hand-off on this common path.
    flow.createHandoffSecret.mockResolvedValue("evt.reuse-key");
    flow.loadAccessState.mockResolvedValue({
      status: "NEED_SIGNIN",
      requestingAppId: "test-app",
      requestedPermissions: OFFER,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
      credentialHandoff: "shared-secret",
    });
    flow.checkAppAccess.mockResolvedValue({
      matchingAccess: { id: "acc-existing", token: "existing-app-token", type: "app", permissions: OFFER },
    });
    render(
      <MemoryRouter initialEntries={["/auth?poll=https://core.test/reg/access/k1"]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();

    await waitFor(() => expect(flow.createHandoffSecret).toHaveBeenCalled());
    // The personal token reached the create — null here is the bug this guards.
    expect(flow.createHandoffSecret.mock.calls[0][1]).toBe("personal-token");
    expect(flow.createHandoffSecret.mock.calls[0][2].secret.token).toBe("existing-app-token");
    const posted = flow.updateAccessState.mock.calls[0][1];
    expect(posted.handoff).toEqual({ type: "shared-secret", key: "evt.reuse-key" });
    expect(posted.token).toBeUndefined();
  });

  it("[AUC2] a refused grant removes the access it had just created, and says why", async () => {
    await renderAndSignIn(stateWithConsent());
    flow.updateAccessState.mockResolvedValue({
      status: 400,
      errorId: "invalid-consent-grant",
      reason: "mandatory-refused",
    });

    screen.getByRole("button", { name: /accept/i }).click();

    await waitFor(() => expect(flow.deleteAppAccess).toHaveBeenCalled());
    // The access minted a moment earlier is the one taken back out.
    expect(flow.deleteAppAccess.mock.calls[0][2]).toBe("acc-new");
    expect(flow.closeOrRedirect).not.toHaveBeenCalled();
    expect(await screen.findByText(/permissions this app requires were not granted/i)).toBeTruthy();
  });

  it("[AUC3] an unverifiable grant is retried once before the access is given up", async () => {
    await renderAndSignIn(stateWithConsent());
    flow.updateAccessState.mockResolvedValue({
      status: 503,
      errorId: "consent-check-unavailable",
      reason: "core-unreachable",
    });

    screen.getByRole("button", { name: /accept/i }).click();

    // Twice: a check that could not run says nothing about the access.
    // The retry waits before firing, so allow more than the 1s default.
    await waitFor(() => expect(flow.updateAccessState).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    expect(await screen.findByText(/could not be verified/i)).toBeTruthy();
    // And the wording is NOT the one used for a genuinely bad grant.
    expect(screen.queryByText(/does not match what this app requested/i)).toBeNull();
  });

  it("[AUC5] a refusal on the already-authorized short-circuit is shown, not swallowed", async () => {
    // check-app can answer with an access that already matches, and the page
    // hands it straight to the register. If the register refuses THAT, the
    // page used to discard the answer and sit on the sign-in card forever.
    flow.loadAccessState.mockResolvedValue(stateWithConsent());
    flow.checkAppAccess.mockResolvedValue({
      matchingAccess: { id: "acc-old", token: "old-token", type: "app", permissions: OFFER },
    });
    flow.updateAccessState.mockResolvedValue({
      status: 400,
      errorId: "invalid-consent-grant",
      reason: "mandatory-refused",
    });
    render(
      <MemoryRouter initialEntries={["/auth?poll=https://core.test/reg/access/k1"]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();

    expect(await screen.findByText(/permissions this app requires were not granted/i)).toBeTruthy();
    // The pre-existing access is not ours to delete: it predates this request.
    expect(flow.deleteAppAccess).not.toHaveBeenCalled();
    expect(flow.closeOrRedirect).not.toHaveBeenCalled();
  });

  it("[AUC4] without a consent form the list stays all-or-nothing", async () => {
    await renderAndSignIn({
      status: "NEED_SIGNIN",
      requestingAppId: "test-app",
      requestedPermissions: OFFER,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
    });

    // No tick boxes at all: the older grammar renders a read-only list.
    expect(checkboxes()).toHaveLength(0);

    screen.getByRole("button", { name: /accept/i }).click();
    await waitFor(() => expect(flow.createAppAccess).toHaveBeenCalled());
    // The whole checked set is minted, exactly as before consent forms.
    expect(flow.createAppAccess.mock.calls[0][2].permissions).toEqual(OFFER);
  });

  it("[AUC9] shows the app's consent message, as text and not as HTML", async () => {
    await renderAndSignIn({
      status: "NEED_SIGNIN",
      requestingAppId: "test-app",
      requestedPermissions: OFFER,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
      clientData: { "app-web-auth:description": { content: "We read your **diary** <img src=x>" } },
    });

    const msg = screen.getByTestId("consent-message");
    expect(msg.textContent).toContain("We read your diary <img src=x>");
    expect(msg.querySelector("strong")?.textContent).toBe("diary");
    expect(msg.querySelector("img")).toBeNull();
  });

  it("[AUC10] Create account and Forgot password carry the pending request", async () => {
    flow.loadAccessState.mockResolvedValue(stateWithConsent());
    render(
      <MemoryRouter initialEntries={["/auth?poll=https%3A%2F%2Fcore.test%2Freg%2Faccess%2Fk1&key=k1"]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    for (const name of ["Create account", "Forgot password?"]) {
      const href = (await screen.findByText(name)).closest("a")!.getAttribute("href")!;
      const p = new URLSearchParams(href.slice(href.indexOf("?")));
      expect(p.get("poll")).toBe("https://core.test/reg/access/k1");
      expect(p.get("key")).toBe("k1");
      expect(p.get("pryvServiceInfoUrl")).toBe("https://core.test/service/info");
    }
  });
});
