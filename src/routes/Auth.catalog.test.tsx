// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The `/auth` consent heading names the requesting app from the operator's
 * catalog, never from anything the app supplied; unknown apps keep their raw
 * id. Stream rows take the deployment's stream labels when it has any.
 */

const flow = vi.hoisted(() => ({
  loadAccessState: vi.fn(),
  updateAccessState: vi.fn(),
  checkAppAccess: vi.fn(),
  createAppAccess: vi.fn(),
  deleteAppAccess: vi.fn(),
  updateAppAccess: vi.fn(),
  closeOrRedirect: vi.fn(),
  createHandoffSecret: vi.fn(),
  deriveServiceInfoUrlFromPollUrl: vi.fn(() => "https://core.test/service/info"),
}));
vi.mock("../lib/accessFlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/accessFlow")>()),
  ...flow,
}));

const catalog = vi.hoisted(() => ({ getAppCatalog: vi.fn() }));
vi.mock("../lib/appCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/appCatalog")>()),
  ...catalog,
}));

const ext = vi.hoisted(() => ({ loadStreamLabels: vi.fn() }));
vi.mock("../extensions/streamLabels", () => ext);

vi.mock("../components/consent/ConsentSignIn", () => ({
  ConsentSignIn: ({
    onSignedIn,
  }: {
    onSignedIn: (s: { username: string; personalToken: string; endpoint: string }) => void;
  }) => (
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
  ),
}));

vi.mock("pryv", () => ({ default: { Service: class {} } }));

import Auth from "./Auth";
import { SessionProvider } from "../lib/session";
import { parseCatalog } from "../lib/appCatalog";
import { resetStreamLabels } from "../lib/streamLabels";

const OFFER = [{ streamId: "diary", level: "read", defaultName: "Journal" }];

async function renderAndSignIn(requestingAppId: string) {
  flow.loadAccessState.mockResolvedValue({
    status: "NEED_SIGNIN",
    requestingAppId,
    requestedPermissions: OFFER,
    serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
    // Self-asserted display fields the screen must NOT use for the heading.
    clientData: { appName: "Totally Official App" },
  });
  flow.checkAppAccess.mockResolvedValue({ checkedPermissions: OFFER });
  render(
    <MemoryRouter initialEntries={["/auth?poll=https://core.test/reg/access/k1"]}>
      <SessionProvider>
        <Auth />
      </SessionProvider>
    </MemoryRouter>,
  );
  (await screen.findByText("sign-in-stub")).click();
  await screen.findByText(/is requesting permission/);
}

describe("[AUCT] /auth consent names the app from the catalog", () => {
  beforeEach(() => {
    for (const fn of Object.values(flow)) fn.mockReset();
    flow.deriveServiceInfoUrlFromPollUrl.mockReturnValue("https://core.test/service/info");
    resetStreamLabels();
    ext.loadStreamLabels.mockReset();
    ext.loadStreamLabels.mockResolvedValue(() => null);
    catalog.getAppCatalog.mockReset();
    catalog.getAppCatalog.mockResolvedValue(
      parseCatalog({
        schemaVersion: 1,
        apps: [
          {
            id: "diary-app",
            name: "Diary Pro",
            description: { en: "Keeps your diary" },
            icon: { type: "emoji", value: "📓" },
          },
        ],
      }),
    );
  });
  afterEach(() => cleanup());

  it("[AUT1] shows the curated name, icon and description for a catalogued app", async () => {
    await renderAndSignIn("diary-app");
    const heading = await screen.findByRole("heading", { name: /Diary Pro/ });
    expect(heading.textContent).toContain("📓");
    expect(screen.getByText("Keeps your diary")).toBeTruthy();
    expect(screen.queryByText("diary-app")).toBeNull();
    expect(screen.queryByText(/Totally Official App/)).toBeNull();
    expect(catalog.getAppCatalog).toHaveBeenCalledWith("https://core.test/service/info");
  });

  it("[AUT2] keeps the raw id for an app the catalog does not know", async () => {
    await renderAndSignIn("unknown-app");
    expect(screen.getByRole("heading", { name: "unknown-app" })).toBeTruthy();
    expect(screen.queryByText(/Totally Official App/)).toBeNull();
  });

  it("[AUT4] labels arriving after the user unticked a row do not tick it back", async () => {
    let resolveLabels: (r: (id: string) => string | null) => void = () => {};
    ext.loadStreamLabels.mockReturnValue(
      new Promise((resolve) => {
        resolveLabels = resolve;
      }),
    );
    const TWO = [
      { streamId: "diary", level: "read", defaultName: "Journal" },
      { streamId: "weight", level: "read", defaultName: "Weight" },
    ];
    flow.loadAccessState.mockResolvedValue({
      status: "NEED_SIGNIN",
      requestingAppId: "diary-app",
      requestedPermissions: TWO,
      serviceInfo: { api: "https://{username}.core.test/", register: "https://core.test/" },
      consent: {
        allowUserChoice: true,
        permissions: [
          { streamId: "diary", level: "read", defaultName: "Journal", mandatory: true },
          { streamId: "weight", level: "read", defaultName: "Weight" },
        ],
      },
    });
    flow.checkAppAccess.mockResolvedValue({ checkedPermissions: TWO });
    flow.createAppAccess.mockResolvedValue({ id: "acc-new", token: "app-token" });
    flow.updateAccessState.mockResolvedValue({ status: 200 });
    render(
      <MemoryRouter initialEntries={["/auth?poll=https://core.test/reg/access/k1"]}>
        <SessionProvider>
          <Auth />
        </SessionProvider>
      </MemoryRouter>,
    );
    (await screen.findByText("sign-in-stub")).click();
    await screen.findByText(/is requesting permission/);

    const boxes = () => Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes()[1].checked).toBe(true);
    await act(async () => {
      boxes()[1].click();
    });
    expect(boxes()[1].checked).toBe(false);

    // The deployment's labels land late.
    await act(async () => {
      resolveLabels((id) => (id === "weight" ? "Body weight" : null));
    });
    expect(await screen.findByText(/Body weight/)).toBeTruthy();
    expect(boxes()[1].checked).toBe(false);

    screen.getByRole("button", { name: /accept/i }).click();
    await waitFor(() => expect(flow.createAppAccess).toHaveBeenCalled());
    expect(flow.createAppAccess.mock.calls[0][2].permissions.map((p: { streamId: string }) => p.streamId)).toEqual([
      "diary",
    ]);
  });

  it("[AUT3] labels stream rows with the deployment's stream labels", async () => {
    ext.loadStreamLabels.mockResolvedValue((id: string) => (id === "diary" ? "My diary" : null));
    await renderAndSignIn("diary-app");
    expect(await screen.findByText(/My diary/)).toBeTruthy();
    expect(screen.queryByText(/Journal/)).toBeNull();
  });
});
