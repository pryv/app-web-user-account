import { test, expect, type BrowserContext } from "@playwright/test";

/**
 * Group memberships (`/account/memberships`), hermetic, over the wire.
 *
 * The signed-in account is the group (`alice`). A member (`bob`) handed over a
 * membership request link: a capability URL on bob's core, read anonymously
 * by the real `@pryv/cmc` client. The administrator approves it for some of
 * its teams, which writes the accept trigger on the group's core; the members
 * list and the offboarding sweeps are read from the group's core too.
 *
 * Every mocked core response carries `meta` (the client rejects a response
 * without it).
 */

const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
};

const CAPABILITY_URL = "https://cap-token@bob.example.test/";
const TEAM_A = ":_cmc:apps:demo:team-a";
const TEAM_B = ":_cmc:apps:demo:team-b";

const OFFER_EVENT = {
  id: "offer-evt-1",
  type: "consent/request-cmc",
  streamIds: [":_cmc:_internal:offer:cap1"],
  time: 1789560000,
  content: {
    request: {
      permissions: [
        { streamId: TEAM_A, level: "contribute" },
        { streamId: TEAM_B, level: "contribute" },
      ],
      consent: { en: "Please let me join the practice." },
      features: { chat: false, systemMessaging: true },
      membership: true,
      allowUserChoice: true,
    },
    requesterMeta: { displayName: "Dr Bob" },
    capability: { mode: "single-use" },
  },
};

/** A member's access on the group's account, as `accesses.get` returns it to the owner. */
const MEMBERSHIP_ACCESS = {
  id: "m-1",
  name: "cmc-carol",
  type: "shared",
  created: 1789560000,
  permissions: [{ streamId: TEAM_A, level: "contribute" }],
  clientData: {
    cmc: {
      role: "member",
      appCode: "demo",
      scopeStreamId: ":_cmc:apps:demo",
      acceptEventId: "acc-1",
      counterparty: { username: "carol", host: "example.test", apiEndpoint: "https://member-grant-token@carol.example.test/" },
      membership: { approvedBy: null, requestedScopes: [TEAM_A] },
    },
  },
};

const SWEEP_EVENT = {
  id: "sw-1",
  type: "consent/member-revoke-cmc",
  streamIds: [":_cmc:apps:demo"],
  time: 1789560000,
  content: {
    member: { username: "frank", host: "example.test" },
    membershipAccessId: "m-9",
    reason: "revoke",
    // A sweep that left an access it could not remove ends this way.
    status: "failed",
    failure: { reason: "cmc-member-revoke-residual", detail: { childAccessId: "c2" } },
    records: [],
    outcome: [
      { childAccessId: "c1", result: "deleted" },
      { childAccessId: "c2", result: "residual" },
    ],
    residuals: [{ counterparty: { username: "patient", host: "far.test" }, childAccessId: "c2", expires: 1789646400, reason: "unreachable" }],
  },
};

interface CoreCall {
  method: string;
  params: Record<string, unknown>;
}

function json(route: import("@playwright/test").Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockGroupPlatform(context: BrowserContext): Promise<{ groupCalls: CoreCall[] }> {
  const mock = { groupCalls: [] as CoreCall[] };
  // Anything this spec did not mock is refused instead of reaching the network.
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await context.route("**/settings.json", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/service/info", (route) => json(route, SERVICE_INFO));

  // The member's core: the request, read through the capability.
  await context.route("https://bob.example.test/access-info", (route) =>
    json(route, { meta: META, type: "shared", name: "cmc capability", user: { username: "bob" } }),
  );
  await context.route("https://bob.example.test/", (route) => {
    const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
    const results = calls.map((c) =>
      c.method === "events.get" ? { events: [OFFER_EVENT] } : { error: { id: "unknown-resource", message: `unmocked ${c.method}` } },
    );
    return json(route, { meta: META, results });
  });

  // The group's core: the signed-in session.
  await context.route("https://alice.example.test/access-info", (route) =>
    json(route, { meta: META, type: "personal", user: { username: "alice" } }),
  );
  await context.route("https://alice.example.test/", (route) => {
    const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
    mock.groupCalls.push(...calls);
    const results = calls.map((c) => {
      switch (c.method) {
        case "account.get":
          return { account: { username: "alice", language: "en" } };
        case "accesses.get":
          return { accesses: [MEMBERSHIP_ACCESS, { id: "app-1", name: "some app", type: "app", permissions: [] }] };
        case "streams.get":
          return {
            streams: [
              {
                id: ":_cmc:apps:demo",
                name: "Demo practice",
                children: [
                  { id: TEAM_A, name: "Team A", children: [] },
                  { id: TEAM_B, name: "Team B", children: [] },
                ],
              },
            ],
          };
        case "events.get":
          return { events: [SWEEP_EVENT] };
        case "events.create": {
          const type = String(c.params.type);
          return {
            event: { id: type === "consent/accept-cmc" ? "accept-evt-1" : "revoke-evt-1", type, streamIds: c.params.streamIds, content: { status: "pending" } },
          };
        }
        case "events.getOne":
          return {
            event: {
              id: c.params.id,
              type: "consent/accept-cmc",
              streamIds: [":_cmc:apps:demo"],
              content: { status: "completed", dataGrantAccessId: "m-2" },
            },
          };
        default:
          return { error: { id: "unknown-resource", message: `unmocked ${c.method}` } };
      }
    });
    return json(route, { meta: META, results });
  });

  await context.addInitScript(() => {
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });
  return mock;
}

test.describe("[MEM] /account/memberships", () => {
  test("[MEM1] a request link opened by the administrator: approved for the teams kept", async ({ page, context }) => {
    const mock = await mockGroupPlatform(context);
    await page.goto("/account/memberships?" + new URLSearchParams({ capabilityUrl: CAPABILITY_URL }).toString());

    await expect(page.getByRole("link", { name: "Group members" })).toBeVisible();
    const request = page.getByTestId("membership-request");
    await expect(request.getByTestId("membership-requester")).toHaveText("bob@example.test");
    // Read once, then out of the address: no tab link carries the token-bearing URL.
    await expect(page).not.toHaveURL(/capabilityUrl/);
    for (const href of await page.getByRole("navigation", { name: "Account sections" }).getByRole("link").evaluateAll(
      (links) => links.map((l) => l.getAttribute("href") ?? ""),
    )) {
      expect(href).not.toContain("cap-token");
    }
    await expect(request.getByTestId("membership-approving-as")).toContainText("You are approving as alice.");
    await expect(request).toContainText("Please let me join the practice.");
    await expect(request.getByLabel("Team A")).toBeChecked();
    await request.getByLabel("Team B").uncheck();
    await request.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText("bob@example.test is now a member.")).toBeVisible();
    const create = mock.groupCalls.find((c) => c.method === "events.create");
    expect(create?.params).toMatchObject({
      streamIds: [":_cmc:apps:demo"],
      type: "consent/accept-cmc",
      content: { capabilityUrl: CAPABILITY_URL, grantedPermissions: [{ streamId: TEAM_A, level: "contribute" }] },
    });
  });

  test("[MEM2] members with Revoke behind the page's dialog; the last sweep with its residual; no token shown", async ({ page, context }) => {
    const mock = await mockGroupPlatform(context);
    await page.goto("/account/memberships");

    const member = page.getByTestId("membership-member");
    await expect(member).toHaveCount(1);
    await expect(member).toContainText("carol@example.test");
    await expect(member).toContainText("Teams: Team A");
    await expect(member).toContainText("Approved by the account owner");

    const sweep = page.getByTestId("membership-sweep");
    await expect(sweep).toContainText("frank@example.test");
    await expect(sweep.getByTestId("membership-sweep-status")).toHaveText("Not finished");
    await expect(sweep.getByTestId("membership-sweep-residual")).toBeVisible();
    await expect(sweep.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(sweep.getByTestId("membership-residuals")).toContainText("An access on patient@far.test could not be removed");

    await member.getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("End the membership of carol@example.test?");
    await dialog.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText(/The membership of carol@example.test has ended/)).toBeVisible();
    const revoke = mock.groupCalls.find((c) => c.method === "events.create");
    expect(revoke?.params).toMatchObject({
      streamIds: [":_cmc:apps:demo"],
      type: "consent/revoke-cmc",
      content: { accessId: "m-1" },
    });

    const text = await page.locator("body").innerText();
    expect(text).not.toContain("member-grant-token");
    expect(text).not.toContain("cap-token");
  });
});
