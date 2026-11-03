// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * [OAGR] An offer that declares entry groups. Entries no group names come
 * first, then the groups in the offer's order (fieldsets whose legend states
 * every count), then the restrictions no group names. A group of more than
 * one entry opens collapsed. With a choice, a tri-state box per group ticks or
 * unticks its unlocked entries; locked entries never change, and the grant
 * posted at Accept stays the flat list of ticked entries. Rows keep the flat
 * list's element ids.
 */

const loginMock = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("../lib/pryvClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pryvClient")>();
  class FakeService {
    login(username: string, password: string, appId: string) {
      return loginMock.login(username, password, appId);
    }
    mfaChallenge() { return Promise.resolve(); }
    mfaVerify() { return Promise.resolve(); }
  }
  return { ...actual, Pryv: { ...actual.Pryv, Service: FakeService } };
});

const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("../lib/returnTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/returnTarget")>()),
  navigateTo: nav.navigateTo,
}));

import Oauth2Authorize from "./Oauth2Authorize";
import { _setDeployedSettingsForTest } from "../lib/deployedSettings";

const CORE = "https://core.other-tld.net";

function base64url(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

const REF_STATE = base64url(JSON.stringify({
  clientId: "registry-client", redirectUri: "https://app.example/cb", state: "c",
  scope: ["x"], iat: 1700000000, exp: 1700000300,
  offerRef: { kind: "synthesised", digest: "d" },
})) + ".fake-mac";

const GROUPS = [
  { key: "vitals", label: { en: "Vital signs" }, entries: ["s|bp", "s|hr", "s|weight", "s|not-on-screen"] },
  // An empty label map: the key is the legend text.
  { key: "journal", label: {}, entries: ["s|diary"] },
  // No entry on this screen: not rendered.
  { key: "absent", label: { en: "Absent group" }, entries: ["s|not-on-screen|read"] },
];

const LABELS = {
  "s|bp": { en: "Blood pressure" },
  "s|hr": { en: "Heart rate" },
  "s|weight": { en: "Weight" },
  "s|diary": { en: "Diary" },
};

/** The screen once signed in: what the app holds joined with what it asks for. */
const COMPOSED = {
  allowUserChoice: true,
  randomAlias: false,
  entryLabels: LABELS,
  entryGroups: GROUPS,
  permissions: [
    { streamId: "notes", level: "read" },                                       // 0 ungrouped
    { streamId: "bp", level: "read", mandatory: true, currentlyGranted: true }, // 1 vitals
    { streamId: "diary", level: "contribute", currentlyGranted: true },         // 2 journal (held only)
    { streamId: "hr", level: "contribute", optIn: true },                       // 3 vitals
    { streamId: "weight", level: "read", optIn: true },                         // 4 vitals
    { feature: "webhooks", setting: "forbidden", mandatory: true },             // 5 restriction
  ],
};

type Answer = { status: number; body: unknown };

function mockCore(offer: Record<string, unknown> = COMPOSED) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    let r: Answer = { status: 404, body: {} };
    if (u.endsWith("/oauth2/authorize/offer")) {
      r = {
        status: 200,
        body: body.userToken == null
          ? { client: { clientId: "registry-client", clientName: "Registry app" }, offer }
          : { client: { clientId: "registry-client", clientName: "Registry app" }, offer, shownDigest: "digest-g", currentGrant: { subjectMode: "account" } },
      };
    } else if (u.endsWith("/oauth2/authorize/accept")) {
      r = { status: 200, body: { redirectTo: "https://app.example/cb?code=1" } };
    } else if (u.endsWith("/auth/logout")) {
      r = { status: 200, body: {} };
    }
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.body) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function signInToConsent() {
  const search = `?state=${encodeURIComponent(REF_STATE)}&pryvApi=${encodeURIComponent(CORE + "/")}`;
  render(
    <MemoryRouter initialEntries={[`/oauth2-authorize${search}`]}>
      <Oauth2Authorize />
    </MemoryRouter>,
  );
  await screen.findByText("Registry app");
  const signIn = screen.getByRole("button", { name: /^sign in$/i }) as HTMLButtonElement;
  await waitFor(() => expect(signIn.disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: "alice" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
  fireEvent.click(signIn);
  await waitFor(() => expect(document.getElementById("oauthAccept")).not.toBeNull());
}

const box = (i: number) => document.getElementById("oauthScope-" + i) as HTMLInputElement;
const groupBox = (gi: number) => document.getElementById(`oauthScope-group-${gi}-box`) as HTMLInputElement;
const toggle = (gi: number) => document.getElementById(`oauthScope-group-${gi}-toggle`) as HTMLButtonElement;
const rowIds = () =>
  Array.from(document.querySelectorAll("input[id^='oauthScope-']"))
    .map((el) => el.id)
    .filter((id) => /^oauthScope-\d+$/.test(id));

beforeEach(() => {
  vi.stubEnv("VITE_OAUTH_TRUSTED_API_ORIGINS", "");
  _setDeployedSettingsForTest({ trustedApiOrigins: [CORE] });
  loginMock.login.mockResolvedValue({ token: "tok", endpoint: CORE + "/alice/" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _setDeployedSettingsForTest(null);
  loginMock.login.mockReset();
  nav.navigateTo.mockReset();
});

describe("[OAGR] Oauth2Authorize grouped consent", () => {
  it("[OAGR1] ungrouped entries first, then groups in the offer's order, restrictions last; flat ids kept", async () => {
    mockCore();
    await signInToConsent();
    expect(rowIds()).toEqual(["oauthScope-0", "oauthScope-1", "oauthScope-3", "oauthScope-4", "oauthScope-2", "oauthScope-5"]);
    const fieldsets = Array.from(document.querySelectorAll("fieldset"));
    expect(fieldsets.map((f) => f.querySelector("legend")?.textContent?.split(" ")[0])).toEqual(["Vital", "journal"]);
    expect(screen.queryByText("Absent group")).toBeNull();
    // Level-less labels name the entries at the level the screen shows.
    expect(screen.getByText("Read “Blood pressure”")).toBeTruthy();
    expect(screen.getByText("Add and modify “Diary”")).toBeTruthy();
  });

  it("[OAGR2] the legend states the count, the levels and the decision counts", async () => {
    mockCore();
    await signInToConsent();
    const vitals = document.querySelector("#oauthScope-group-0 legend")?.textContent ?? "";
    expect(vitals).toContain("Vital signs");
    expect(vitals).toContain("3 entries (Read: 2, Add and modify: 1); 1 required, 1 already allowed, 2 new or previously declined");
    const journal = document.querySelector("#oauthScope-group-1 legend")?.textContent ?? "";
    expect(journal).toContain("1 entry (Add and modify: 1); 1 already allowed");
  });

  it("[OAGR3] a group of several entries opens collapsed; the toggle keeps focus and reports its state", async () => {
    mockCore();
    await signInToConsent();
    const list = document.getElementById("oauthScope-group-0-entries") as HTMLElement;
    expect(toggle(0).getAttribute("aria-expanded")).toBe("false");
    expect(toggle(0).getAttribute("aria-controls")).toBe(list.id);
    expect(list.hidden).toBe(true);
    // Collapsed rows are out of the accessibility tree and the tab order.
    expect(screen.queryByRole("checkbox", { name: /Heart rate/ })).toBeNull();
    // A single-entry group opens expanded.
    expect(toggle(1).getAttribute("aria-expanded")).toBe("true");
    expect((document.getElementById("oauthScope-group-1-entries") as HTMLElement).hidden).toBe(false);
    toggle(0).focus();
    fireEvent.click(toggle(0));
    expect(toggle(0).getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(document.activeElement).toBe(toggle(0));
    expect(screen.getByRole("checkbox", { name: /Heart rate/ })).toBeTruthy();
    fireEvent.click(toggle(0));
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle(0));
  });

  it("[OAGR4] the group box is tri-state: none, some, all; locked entries never change", async () => {
    mockCore();
    await signInToConsent();
    // optIn entries open unticked; the mandatory one is locked and not counted.
    expect(groupBox(0).checked).toBe(false);
    expect(groupBox(0).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box(3));
    expect(groupBox(0).indeterminate).toBe(true);
    expect(groupBox(0).getAttribute("aria-checked")).toBe("mixed");
    // Mixed: activating ticks every unlocked entry.
    fireEvent.click(groupBox(0));
    expect([box(3).checked, box(4).checked]).toEqual([true, true]);
    expect(groupBox(0).checked).toBe(true);
    expect(groupBox(0).indeterminate).toBe(false);
    expect(groupBox(0).getAttribute("aria-checked")).toBe("true");
    // Checked: activating unticks them; the locked entry stays ticked.
    fireEvent.click(groupBox(0));
    expect([box(3).checked, box(4).checked]).toEqual([false, false]);
    expect(box(1).checked).toBe(true);
    expect(box(1).disabled).toBe(true);
    // Entries outside the group are untouched.
    expect(box(0).checked).toBe(true);
    expect(box(2).checked).toBe(true);
    // The group box is labelled by the group and described by its counts.
    const named = screen.getByRole("checkbox", { name: "Vital signs" });
    expect(named).toBe(groupBox(0));
    expect(document.getElementById(named.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(/3 entries/);
  });

  it("[OAGR5] unticking a group takes held entries away; Accept posts the flat ticked set", async () => {
    const fetchMock = mockCore();
    await signInToConsent();
    expect(groupBox(1).checked).toBe(true);
    fireEvent.click(groupBox(1));
    expect(box(2).checked).toBe(false);
    fireEvent.click(document.getElementById("oauthAccept")!);
    await waitFor(() => expect(nav.navigateTo).toHaveBeenCalledWith("https://app.example/cb?code=1"));
    const accept = fetchMock.mock.calls
      .filter(([u]) => String(u).endsWith("/oauth2/authorize/accept"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>)[0];
    expect(accept.shownDigest).toBe("digest-g");
    expect(accept.grantedPermissions).toEqual([
      { streamId: "notes", level: "read" },
      { streamId: "bp", level: "read" },
      { feature: "webhooks", setting: "forbidden" },
    ]);
  });

  it("[OAGR6] without a choice: collapsible read-only groups, no boxes at all", async () => {
    mockCore({ ...COMPOSED, allowUserChoice: false });
    await signInToConsent();
    expect(document.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
    expect(document.querySelectorAll("fieldset")).toHaveLength(2);
    const legend = document.querySelector("#oauthScope-group-0 legend")?.textContent ?? "";
    expect(legend).toContain("3 entries (Read: 2, Add and modify: 1); 1 already allowed");
    expect(legend).not.toMatch(/required|new or previously declined/);
    expect(toggle(0).getAttribute("aria-expanded")).toBe("false");
  });

  it("[OAGR7] groups naming no entry of the screen leave the flat list as before", async () => {
    mockCore({ ...COMPOSED, entryGroups: [{ key: "x", label: { en: "X" }, entries: ["s|elsewhere"] }] });
    await signInToConsent();
    expect(document.querySelectorAll("fieldset")).toHaveLength(0);
    expect(rowIds()).toEqual(["oauthScope-0", "oauthScope-1", "oauthScope-2", "oauthScope-3", "oauthScope-4", "oauthScope-5"]);
  });

  it("[OAGR8] accessibility: each group is a named group whose name carries its counts", async () => {
    mockCore();
    await signInToConsent();
    const vitals = screen.getByRole("group", { name: /Vital signs/ });
    expect(vitals.tagName).toBe("FIELDSET");
    expect(within(vitals).getByRole("button", { name: /Show the 3 entries/ })).toBe(toggle(0));
    const journal = screen.getByRole("group", { name: /journal/ });
    expect(within(journal).getByRole("button", { name: /Hide the entries/ })).toBe(toggle(1));
    // No state lives in colour only: every count is text in the legend.
    expect(vitals.querySelector("legend")?.textContent).toMatch(/\d+ required/);
  });
});
