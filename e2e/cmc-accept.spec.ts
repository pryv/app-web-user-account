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
        ? { events: [OFFER_EVENT] }
        : { error: { id: "unknown-resource", message: `unmocked ${c.method}` } },
    );
    return json(route, { meta: META, results });
  });

  // The accepter's core: the signed-in session.
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
        return {
          event: completedTrigger(refuse ? REFUSE_EVENT_ID : ACCEPT_EVENT_ID, String(c.params.type), "pending"),
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
