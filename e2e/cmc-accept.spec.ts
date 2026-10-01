import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

/**
 * Cross-account approval (`/cmc-accept`), hermetic, over the wire.
 *
 * Drives the page from the offer to the result it hands back, with the real
 * `@pryv/cmc` client talking to mocked cores:
 *
 *   - the CAPABILITY host (`https://cap-token@requester.example.test/`), read
 *     anonymously through the capability: `events.get` for the offer, then
 *     `service/info` and `access-info` for the requester's identity;
 *   - the ACCEPTER's core (`https://alice.example.test/`, the signed-in
 *     session): `events.create` writes the accept or refuse trigger, and
 *     `events.getOne` is polled until the trigger reads `completed`.
 *
 * The result goes back by redirect (`?cmcAcceptResult=<json>` on `returnUrl`)
 * or by `postMessage` to the opener. The result is the outcome only (`ok`,
 * `acceptEventId` or `reason`): it never carries a credential, whatever the
 * target origin, because the requester obtains its data-grant endpoint on its
 * own side (@pryv/cmc `waitForAccept`).
 *
 * Every mocked core response carries `meta` (see delegation.spec.ts: the
 * client rejects a response without it).
 */

const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
};

const CAPABILITY_URL = "https://cap-token@requester.example.test/";
const SCOPE_STREAM_ID = ":_cmc:apps:demo";
const ACCEPT_EVENT_ID = "accept-evt-1";
const REFUSE_EVENT_ID = "refuse-evt-1";
const RETURN_URL = "https://app.example.test/done";

const OFFER_EVENT = {
  id: "offer-evt-1",
  type: "consent/request-cmc",
  streamIds: [":_cmc:_internal:offer:cap1"],
  time: 1789560000,
  content: {
    request: {
      permissions: [{ streamId: "diary", defaultName: "Diary", level: "read" }],
      consent: { en: "Share your diary with your doctor." },
      features: { chat: true, systemMessaging: true },
    },
    requesterMeta: { displayName: "Dr Bob" },
    capability: { mode: "single-use" },
  },
};

interface CoreCall {
  method: string;
  params: Record<string, unknown>;
}

interface Mock {
  /** Every call the accepter's core received, in order. */
  accepterCalls: CoreCall[];
}

interface MockOptions {
  /** When set, `events.create` on the accepter's core fails with this plugin error id. */
  createErrorId?: string;
  /** settings.json served by the deployment. Default: none (404). */
  settings?: Record<string, unknown>;
  /** Ids of the accept triggers `events.create` records, in order. Default: always ACCEPT_EVENT_ID. */
  acceptEventIds?: string[];
  /** Stamped on the offer as the requester's scope (`originStreamId`). Default: none. */
  offerOriginStreamId?: string;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** The trigger event as the platform records it once completed: no token anywhere. */
function completedTrigger(id: string, type: string, status: string) {
  return {
    id,
    type,
    streamIds: [SCOPE_STREAM_ID],
    time: 1789560001,
    content: {
      capabilityUrl: "https://requester.example.test/",
      status,
      dataGrantAccessId: "grant-access-1",
      acceptedBy: { apiEndpoint: "https://alice.example.test/" },
      from: { username: "bob", host: "example.test" },
    },
  };
}

async function mockCmcPlatform(context: BrowserContext, opts: MockOptions = {}): Promise<Mock> {
  const mock: Mock = { accepterCalls: [] };

  // Registered first so every specific route below wins: anything this spec
  // did not mock is refused instead of reaching the network.
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());

  await context.route("**/settings.json", (route) =>
    opts.settings ? json(route, opts.settings) : route.fulfill({ status: 404, body: "" }),
  );
  await context.route("**/service/info", (route) => json(route, SERVICE_INFO));
  await context.route("https://app.example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>done</title>" }),
  );

  // The capability host: the offer, read through the capability access.
  await context.route("https://requester.example.test/access-info", (route) =>
    json(route, { meta: META, type: "shared", name: "cmc capability", user: { username: "bob" } }),
  );
  await context.route("https://requester.example.test/", (route) => {
    const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
    const results = calls.map((c) =>
      c.method === "events.get"
        ? {
            events: [
              opts.offerOriginStreamId
                ? { ...OFFER_EVENT, content: { ...OFFER_EVENT.content, originStreamId: opts.offerOriginStreamId } }
                : OFFER_EVENT,
            ],
          }
        : { error: { id: "unknown-resource", message: `unmocked ${c.method}` } },
    );
    return json(route, { meta: META, results });
  });

  // The accepter's core: the signed-in session.
  let acceptsRecorded = 0;
  await context.route("https://alice.example.test/access-info", (route) =>
    json(route, { meta: META, type: "personal", user: { username: "alice" } }),
  );
  await context.route("https://alice.example.test/", (route) => {
    const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
    mock.accepterCalls.push(...calls);
    const results = calls.map((c) => {
      if (c.method === "events.create") {
        if (opts.createErrorId) {
          return {
            error: {
              id: "invalid-operation",
              message: "The capability was refused.",
              data: { id: opts.createErrorId },
            },
          };
        }
        const refuse = c.params.type === "consent/refuse-cmc";
        const id = refuse ? REFUSE_EVENT_ID : (opts.acceptEventIds?.[acceptsRecorded++] ?? ACCEPT_EVENT_ID);
        return {
          event: completedTrigger(id, String(c.params.type), "pending"),
        };
      }
      if (c.method === "events.getOne") {
        return {
          event: completedTrigger(String(c.params.id), "consent/accept-cmc", "completed"),
        };
      }
      return { error: { id: "unknown-resource", message: `unmocked ${c.method}` } };
    });
    return json(route, { meta: META, results });
  });

  // Seed a session: exact keys from src/lib/session.tsx.
  await context.addInitScript(() => {
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });

  return mock;
}

function acceptPath(extra: Record<string, string>): string {
  const q = new URLSearchParams({ capabilityUrl: CAPABILITY_URL, scopeStreamId: SCOPE_STREAM_ID, ...extra });
  return `/cmc-accept?${q.toString()}`;
}

/** The `cmcAcceptResult` handed back on the landing URL. */
function landingResult(page: Page): Record<string, unknown> {
  const raw = new URL(page.url()).searchParams.get("cmcAcceptResult");
  expect(raw, "landing URL carries cmcAcceptResult").not.toBeNull();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

async function expectOfferShown(page: Page) {
  await expect(page.getByTestId("cmc-requester")).toHaveText("bob@example.test");
  await expect(page.getByText("Share your diary with your doctor.")).toBeVisible();
}

test.describe("/cmc-accept redirect mode", () => {
  test("[CMA1] approve: the returnUrl receives the outcome, and no credential", async ({ page, context }) => {
    const mock = await mockCmcPlatform(context);
    await page.goto(acceptPath({ mode: "redirect", returnUrl: RETURN_URL }));
    await expectOfferShown(page);

    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL("https://app.example.test/done?**");

    const result = landingResult(page);
    expect(result).toEqual({ ok: true, acceptEventId: ACCEPT_EVENT_ID });

    const create = mock.accepterCalls.find((c) => c.method === "events.create");
    expect(create?.params).toMatchObject({
      streamIds: [SCOPE_STREAM_ID],
      type: "consent/accept-cmc",
      content: { capabilityUrl: CAPABILITY_URL },
    });
    expect(mock.accepterCalls.some((c) => c.method === "events.getOne")).toBe(true);
  });

  // An operator-trusted origin gets exactly the same result: the hand-off never
  // carries a credential, so trust does not change what is sent.
  test("[CMA2] approve: an allowlisted returnUrl receives the same outcome", async ({ page, context }) => {
    await mockCmcPlatform(context, { settings: { trustedApiOrigins: ["https://app.example.test"] } });
    await page.goto(acceptPath({ mode: "redirect", returnUrl: RETURN_URL }));
    await expectOfferShown(page);

    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL("https://app.example.test/done?**");

    expect(landingResult(page)).toEqual({ ok: true, acceptEventId: ACCEPT_EVENT_ID });
  });

  test("[CMA3] decline: writes the refuse trigger and reports declined-by-user", async ({ page, context }) => {
    const mock = await mockCmcPlatform(context);
    await page.goto(acceptPath({ mode: "redirect", returnUrl: RETURN_URL }));
    await expectOfferShown(page);

    await page.getByRole("button", { name: "Decline" }).click();
    await page.waitForURL("https://app.example.test/done?**");

    expect(landingResult(page)).toEqual({ ok: false, reason: "declined-by-user" });
    const creates = mock.accepterCalls.filter((c) => c.method === "events.create");
    expect(creates).toHaveLength(1);
    expect(creates[0].params).toMatchObject({
      streamIds: [SCOPE_STREAM_ID],
      type: "consent/refuse-cmc",
      content: { capabilityUrl: CAPABILITY_URL },
    });
  });
});

test.describe("/cmc-accept popup mode", () => {
  /** Open the page as a popup from a same-origin opener that records what it is sent. */
  async function openPopup(page: Page, context: BrowserContext): Promise<Page> {
    await page.goto("/cmc-accept");
    await page.evaluate(() => {
      const w = window as unknown as { cmcMessages: unknown[] };
      w.cmcMessages = [];
      window.addEventListener("message", (e) => w.cmcMessages.push({ origin: e.origin, data: e.data }));
    });
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate((path) => {
        window.open(path, "cmc-accept");
      }, acceptPath({ mode: "popup" })),
    ]);
    return popup;
  }

  function received(page: Page) {
    return page.evaluate(() => (window as unknown as { cmcMessages: unknown[] }).cmcMessages);
  }

  test("[CMA4] approve: posts the result to the opener and closes the popup", async ({ page, context }) => {
    await mockCmcPlatform(context);
    const popup = await openPopup(page, context);
    await expectOfferShown(popup);

    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Approve" }).click();
    await closed;

    await expect.poll(() => received(page)).toHaveLength(1);
    const [msg] = (await received(page)) as Array<{ origin: string; data: Record<string, unknown> }>;
    expect(msg.origin).toBe(new URL(page.url()).origin);
    expect(msg.data).toEqual({ type: "cmc-accept-result", ok: true, acceptEventId: ACCEPT_EVENT_ID });
  });

  test("[CMA5] a consumed link: reports cmc-capability-consumed to the opener", async ({ page, context }) => {
    await mockCmcPlatform(context, { createErrorId: "cmc-capability-consumed" });
    const popup = await openPopup(page, context);
    await expectOfferShown(popup);

    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Approve" }).click();
    await closed;

    await expect.poll(() => received(page)).toHaveLength(1);
    const [msg] = (await received(page)) as Array<{ data: Record<string, unknown> }>;
    expect(msg.data).toEqual({
      type: "cmc-accept-result",
      ok: false,
      reason: "cmc-capability-consumed",
    });
  });
});

/**
 * `/auth` with `next=/cmc-accept?…`: one pop-up, two decisions. The app (on its
 * own origin) opens `/auth`; once the access is granted, the pop-up continues
 * to the consent offer in the same window, and the offer's outcome reaches the
 * app's page. After that hop the referrer is the account app itself, so the
 * result must be pinned to `returnUrl`'s origin (the app), never to the
 * referrer's: a wrong pin drops the message silently, which is what [CHN2]
 * catches.
 */
test.describe("[CHN] /auth continues to /cmc-accept in the same window", () => {
  const POLL = "https://reg.example.test/reg/access/chain1";
  const OPENER = "https://app.example.test/opener";
  const PERMS = [{ streamId: "diary", defaultName: "Diary", level: "read" }];

  async function mockAccessRequest(context: BrowserContext, posted: Array<Record<string, unknown>>) {
    await context.route(POLL, (route) => {
      if (route.request().method() === "POST") {
        posted.push(route.request().postDataJSON() as Record<string, unknown>);
        return json(route, { status: "ACCEPTED" });
      }
      return json(route, { status: "NEED_SIGNIN", requestingAppId: "chain-app", requestedPermissions: PERMS });
    });
    await context.route("https://alice.example.test/accesses/check-app", (route) =>
      json(route, { meta: META, checkedPermissions: PERMS }),
    );
    await context.route("https://alice.example.test/accesses", (route) =>
      json(route, { meta: META, access: { id: "app-access-1", token: "app-token-1", type: "app", permissions: PERMS } }),
    );
    // The app's page: records every message it receives.
    await context.route(OPENER, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body:
          "<!doctype html><title>The app</title><script>window.cmcMessages = [];" +
          "window.addEventListener('message', (e) => window.cmcMessages.push({ origin: e.origin, data: e.data }));</script>",
      }),
    );
  }

  /** From the app's page, open `/auth` chained to the offer, and grant the access. */
  async function grantInPopup(page: Page, context: BrowserContext, baseURL: string): Promise<Page> {
    const next =
      "/cmc-accept?" +
      new URLSearchParams({
        capabilityUrl: CAPABILITY_URL,
        scopeStreamId: SCOPE_STREAM_ID,
        mode: "popup",
        returnUrl: "https://app.example.test/",
      }).toString();
    const authUrl =
      new URL("/auth", baseURL).toString() +
      "?" +
      new URLSearchParams({ poll: POLL, pryvServiceInfoUrl: "https://reg.example.test/service/info", next }).toString();
    await page.goto(OPENER);
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate((url) => {
        window.open(url, "prYv Sign-in", "width=400,height=620");
      }, authUrl),
    ]);
    // The stored session stands for the sign-in.
    await popup.getByRole("button", { name: "Continue as alice" }).click();
    await expect(popup.getByText(/is requesting permission/)).toBeVisible();
    await popup.getByRole("button", { name: "Accept" }).click();
    await popup.waitForURL(/\/cmc-accept\?/);
    return popup;
  }

  function received(page: Page) {
    return page.evaluate(() => (window as unknown as { cmcMessages: unknown[] }).cmcMessages);
  }

  test("[CHN2] grant, then the offer in the same pop-up: Approve reaches the app's page", async ({ page, context, baseURL }) => {
    const mock = await mockCmcPlatform(context);
    const posted: Array<Record<string, unknown>> = [];
    await mockAccessRequest(context, posted);
    const popup = await grantInPopup(page, context, baseURL!);

    // The access was granted and handed over before the hop.
    expect(posted).toHaveLength(1);
    expect(posted[0].status).toBe("ACCEPTED");
    // The offer page carries its own query only: no `next`, no poll URL.
    const landed = new URL(popup.url()).searchParams;
    expect(landed.get("next")).toBeNull();
    expect(landed.get("poll")).toBeNull();
    expect(landed.get("capabilityUrl")).toBe(CAPABILITY_URL);
    await expectOfferShown(popup);

    // Control: after the hop the referrer is the account app itself, and a
    // result pinned to the referrer's origin (the pin before this rule) never
    // reaches the app's page. Only the result of Approve may arrive below.
    const appOrigin = new URL(baseURL!).origin;
    const referrer = await popup.evaluate(() => document.referrer);
    expect(new URL(referrer).origin).toBe(appOrigin);
    await popup.evaluate((origin) => {
      window.opener.postMessage({ type: "control-referrer-pin" }, origin);
    }, appOrigin);

    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Approve" }).click();
    await closed;

    await expect.poll(() => received(page)).toHaveLength(1);
    const [msg] = (await received(page)) as Array<{ origin: string; data: Record<string, unknown> }>;
    expect(msg.data).toEqual({ type: "cmc-accept-result", ok: true, acceptEventId: ACCEPT_EVENT_ID });
    expect(msg.origin).toBe(new URL(baseURL!).origin);
    expect(page.url()).toBe(OPENER);
    expect(mock.accepterCalls.some((c) => c.method === "events.create" && c.params.type === "consent/accept-cmc")).toBe(true);
  });

  test("[CHN7] Decline on the offer: the app access stays granted and the app reads declined-by-user", async ({ page, context, baseURL }) => {
    const mock = await mockCmcPlatform(context);
    const posted: Array<Record<string, unknown>> = [];
    await mockAccessRequest(context, posted);
    const popup = await grantInPopup(page, context, baseURL!);
    await expectOfferShown(popup);

    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Decline" }).click();
    await closed;

    await expect.poll(() => received(page)).toHaveLength(1);
    const [msg] = (await received(page)) as Array<{ data: Record<string, unknown> }>;
    expect(msg.data).toEqual({ type: "cmc-accept-result", ok: false, reason: "declined-by-user" });
    // Two decisions: the app access was handed over (ACCEPTED, once) and never undone.
    expect(posted).toHaveLength(1);
    expect(posted[0].status).toBe("ACCEPTED");
    expect(posted[0].token).toBe("app-token-1");
    const creates = mock.accepterCalls.filter((c) => c.method === "events.create");
    expect(creates.map((c) => c.params.type)).toEqual(["consent/refuse-cmc"]);
  });
});

test.describe("/cmc-accept without opener or returnUrl", () => {
  // Nothing to hand the result to, so the page stays open and the user reads
  // the outcome there.
  test("[CMA6] a consumed link is shown as information, not as an error", async ({ page, context }) => {
    await mockCmcPlatform(context, { createErrorId: "cmc-capability-consumed" });
    await page.goto(acceptPath({}));
    await expectOfferShown(page);

    await page.getByRole("button", { name: "Approve" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "already been used" });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveClass(/bg-info/);
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  });
});

/**
 * `/auth` with consent invites in the access request (`cmcInvites`): the
 * invites are answered on the consent screen itself, accepted with the real
 * `@pryv/cmc` client before the app access is created, and their outcomes
 * ride on the ACCEPTED answer.
 */
test.describe("[ACI] /auth with consent invites", () => {
  const POLL = "https://reg.example.test/reg/access/aci1";
  const PERMS = [{ streamId: "diary", defaultName: "Diary", level: "read" }];
  const CAP_MANDATORY = "https://cap-a@requester.example.test/";
  const CAP_OPTIONAL = "https://cap-b@requester.example.test/";
  const ORIGIN_SCOPE = ":_cmc:apps:demo:study-1";

  test("[ACI8] one mandatory and one optional invite, both approved: two outcomes on ACCEPTED", async ({ page, context }) => {
    const mock = await mockCmcPlatform(context, {
      acceptEventIds: ["aci-ev-1", "aci-ev-2"],
      offerOriginStreamId: ORIGIN_SCOPE,
    });
    const posted: Array<Record<string, unknown>> = [];
    const order: string[] = [];
    await context.route(POLL, (route) => {
      if (route.request().method() === "POST") {
        posted.push(route.request().postDataJSON() as Record<string, unknown>);
        return json(route, { status: "ACCEPTED" });
      }
      return json(route, {
        status: "NEED_SIGNIN",
        requestingAppId: "carer-app",
        requestedPermissions: PERMS,
        cmcInvites: [
          { capabilityUrl: CAP_MANDATORY, mandatory: true, for: "self" },
          { capabilityUrl: CAP_OPTIONAL, mandatory: false, for: "self" },
        ],
      });
    });
    await context.route("https://alice.example.test/accesses/check-app", (route) =>
      json(route, { meta: META, checkedPermissions: PERMS }),
    );
    await context.route("https://alice.example.test/accesses", (route) => {
      order.push("accesses.create after " + mock.accepterCalls.filter((c) => c.method === "events.create").length + " accepts");
      return json(route, { meta: META, access: { id: "app-access-1", token: "app-token-1", type: "app", permissions: PERMS } });
    });

    await page.goto(
      "/auth?" + new URLSearchParams({ poll: POLL, pryvServiceInfoUrl: "https://reg.example.test/service/info" }).toString(),
    );
    await page.getByRole("button", { name: "Continue as alice" }).click();
    await expect(page.getByText(/is requesting permission/)).toBeVisible();

    const blocks = page.getByTestId("cmc-invite");
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0).getByTestId("cmc-requester")).toHaveText("bob@example.test");
    await expect(blocks.nth(1).getByTestId("cmc-requester")).toHaveText("bob@example.test");
    await expect(blocks.nth(0)).toContainText("required");
    await expect(blocks.nth(1)).toContainText("optional");

    const cont = page.getByRole("button", { name: "Continue" });
    await expect(cont).toBeDisabled();
    await blocks.nth(0).getByRole("button", { name: "Approve" }).click();
    await expect(cont).toBeDisabled();
    await blocks.nth(1).getByRole("button", { name: "Approve" }).click();
    await expect(cont).toBeEnabled();
    // Deciding wrote nothing.
    expect(mock.accepterCalls.some((c) => c.method === "events.create")).toBe(false);
    await cont.click();

    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].status).toBe("ACCEPTED");
    expect(posted[0].token).toBe("app-token-1");
    expect(posted[0].cmcInvites).toEqual([
      { acceptEventId: "aci-ev-1", dataGrantAccessId: "grant-access-1" },
      { acceptEventId: "aci-ev-2", dataGrantAccessId: "grant-access-1" },
    ]);
    // Both accepted on the requester's scope, before the access was created.
    const creates = mock.accepterCalls.filter((c) => c.method === "events.create");
    expect(creates.map((c) => c.params.content)).toEqual([
      expect.objectContaining({ capabilityUrl: CAP_MANDATORY }),
      expect.objectContaining({ capabilityUrl: CAP_OPTIONAL }),
    ]);
    for (const c of creates) {
      expect(c.params).toMatchObject({ streamIds: [ORIGIN_SCOPE], type: "consent/accept-cmc" });
    }
    expect(order).toEqual(["accesses.create after 2 accepts"]);
  });
});
