import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";

/**
 * Cross-account scope update (`/cmc-scope-update`), hermetic, over the wire.
 *
 * The collector proposed a new permission set; the request event lives on the
 * signed-in account, and the page answers it with the real `@pryv/cmc` client
 * talking to mocked cores (`https://{username}.example.test/`):
 *
 *   - `access-info` names the signed-in account ("You are approving as ...");
 *   - `events.getOne` on the request id reads the proposal;
 *   - `events.create` writes the `consent/scope-update-cmc` trigger, and
 *     `events.getOne` on the trigger is polled until it reads `completed`.
 *
 * Switching account signs out and goes through `/signin` (`auth/login` on the
 * other account's core), back to the same request.
 *
 * Every mocked core response carries `meta` (the client rejects one without it).
 */

const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO_URL = "https://reg.example.test/service/info";
const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
};

const REQUEST_ID = "scope-req-1";
const SCOPE_STREAM_ID = ":_cmc:apps:demo:collectors:bob";
const UPDATE_EVENT_ID = "scope-upd-1";
const RETURN_URL = "https://app.example.test/done";

interface CoreCall {
  method: string;
  params: Record<string, unknown>;
}

interface MockOptions {
  /** `content.status` of the request: `accepted` / `refused` once answered. Default: open. */
  requestStatus?: string;
  /** When set, reading the request fails with this error id. */
  requestErrorId?: string;
  /**
   * `access-info` of the seeded account: `hang` never answers until
   * `releaseAccessInfo` is called, `fail` answers an error. Default: answers.
   */
  accessInfo?: "hang" | "fail";
}

interface Mock {
  /** Every batch call each core received, in order, by username. */
  calls: Record<string, CoreCall[]>;
  /** `auth/login` bodies, in order. */
  logins: Array<Record<string, unknown>>;
  /** Answers a held (`hang`) `access-info` of the seeded account. */
  releaseAccessInfo: () => void;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** The scope-update trigger as the platform records it. */
function trigger(status: string, accept: boolean) {
  return {
    id: UPDATE_EVENT_ID,
    type: "consent/scope-update-cmc",
    streamIds: [SCOPE_STREAM_ID],
    time: 1789560001,
    content:
      status === "completed"
        ? { scopeRequestEventId: REQUEST_ID, accept, status, applied: accept, accessId: "grant-access-1" }
        : { scopeRequestEventId: REQUEST_ID, accept, status },
  };
}

async function mockScopePlatform(context: BrowserContext, opts: MockOptions = {}): Promise<Mock> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mock: Mock = { calls: {}, logins: [], releaseAccessInfo: () => release() };

  // Registered first so every specific route below wins: anything this spec
  // did not mock is refused instead of reaching the network.
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());

  await context.route("**/settings.json", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route(SERVICE_INFO_URL, (route) => json(route, SERVICE_INFO));
  await context.route("https://app.example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>done</title>" }),
  );

  for (const username of ["alice", "carol"]) {
    const core = `https://${username}.example.test/`;
    mock.calls[username] = [];

    await context.route(`${core}auth/login`, (route) => {
      mock.logins.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { meta: META, token: `tok-${username}`, apiEndpoint: core });
    });

    await context.route(`${core}access-info`, async (route) => {
      if (username === "alice" && opts.accessInfo === "hang") await held;
      if (username === "alice" && opts.accessInfo === "fail") {
        return json(route, { meta: META, error: { id: "unexpected-error", message: "down" } }, 500);
      }
      return json(route, { meta: META, type: "personal", name: "pryv-user-account", user: { username } });
    });

    let decision = true;
    await context.route(core, (route) => {
      const calls = (route.request().postDataJSON() ?? []) as CoreCall[];
      mock.calls[username].push(...calls);
      const results = calls.map((c) => {
        if (c.method === "events.getOne" && c.params.id === REQUEST_ID) {
          if (opts.requestErrorId) {
            return { error: { id: opts.requestErrorId, message: "Unknown event" } };
          }
          return {
            event: {
              id: REQUEST_ID,
              type: "consent/scope-request-cmc",
              streamIds: [SCOPE_STREAM_ID],
              time: 1789560000,
              content: {
                newPermissions: [{ streamId: "diary", defaultName: "Diary", level: "contribute" }],
                message: "We would also like to add entries to your diary.",
                ...(opts.requestStatus ? { status: opts.requestStatus } : {}),
              },
            },
          };
        }
        if (c.method === "events.create") {
          decision = (c.params.content as { accept?: boolean } | undefined)?.accept === true;
          return { event: trigger("pending", decision) };
        }
        if (c.method === "events.getOne" && c.params.id === UPDATE_EVENT_ID) {
          return { event: trigger("completed", decision) };
        }
        return { error: { id: "unknown-resource", message: `unmocked ${c.method}` } };
      });
      return json(route, { meta: META, results });
    });
  }

  // Seed alice's session once per tab (exact keys from src/lib/session.tsx):
  // a reload after switching account must not bring her back.
  await context.addInitScript(() => {
    if (window.sessionStorage.getItem("e2e.seeded")) return;
    window.sessionStorage.setItem("e2e.seeded", "1");
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });

  return mock;
}

function scopeUpdatePath(extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ scopeRequestEventId: REQUEST_ID, scopeStreamId: SCOPE_STREAM_ID, ...extra });
  return `/cmc-scope-update?${q.toString()}`;
}

/** The `cmcScopeUpdateResult` handed back on the landing URL. */
function landingResult(page: Page): Record<string, unknown> {
  const raw = new URL(page.url()).searchParams.get("cmcScopeUpdateResult");
  expect(raw, "landing URL carries cmcScopeUpdateResult").not.toBeNull();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

async function expectProposalShown(page: Page) {
  await expect(page.getByRole("heading", { name: "Approve scope update" })).toBeVisible();
  await expect(page.getByText("We would also like to add entries to your diary.")).toBeVisible();
  await expect(page.getByText("Proposed permissions:")).toBeVisible();
}

function creates(mock: Mock, username: string): CoreCall[] {
  return mock.calls[username].filter((c) => c.method === "events.create");
}

/**
 * On `/signin` after switching account: the request rides along with
 * `next=/cmc-scope-update`, the session is gone (the form shows, not "Welcome
 * back"), and signing in as carol lands back on the same request.
 */
async function signInAsCarolAndReturn(page: Page, mock: Mock, expectedUsernameField: string) {
  await page.waitForURL(/\/signin\?/);
  const target = new URL(page.url()).searchParams;
  expect(target.get("next")).toBe("/cmc-scope-update");
  expect(target.get("scopeRequestEventId")).toBe(REQUEST_ID);
  expect(target.get("scopeStreamId")).toBe(SCOPE_STREAM_ID);
  expect(target.get("pryvServiceInfoUrl")).toBe(SERVICE_INFO_URL);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("#username")).toHaveValue(expectedUsernameField);

  await page.locator("#username").fill("carol");
  await page.getByLabel("Password").fill("hunter2");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/cmc-scope-update\?/);
  const back = new URL(page.url()).searchParams;
  expect(back.get("next")).toBeNull();
  expect(back.get("scopeRequestEventId")).toBe(REQUEST_ID);
  expect(back.get("scopeStreamId")).toBe(SCOPE_STREAM_ID);
  expect(mock.logins).toHaveLength(1);
  expect(mock.logins[0].username).toBe("carol");

  await expectProposalShown(page);
  await expect(page.getByTestId("cmc-approving-as")).toContainText("You are approving as carol.");
}

test.describe("/cmc-scope-update: the account that answers", () => {
  test("[SUE1] approve: names the account, writes the accept trigger, hands the outcome to returnUrl", async ({ page, context }) => {
    const mock = await mockScopePlatform(context);
    await page.goto(scopeUpdatePath({ returnUrl: RETURN_URL }));
    await expectProposalShown(page);
    await expect(page.getByTestId("cmc-approving-as")).toContainText("You are approving as alice.");
    await expect(page.getByRole("button", { name: "Not you? Switch account" })).toBeVisible();
    await expect(page.getByTestId("cmc-switch-account")).toHaveCount(0);

    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForURL("https://app.example.test/done?**");

    expect(landingResult(page)).toEqual({ ok: true, updateEventId: UPDATE_EVENT_ID, action: "accept", peerNotified: true });
    const written = creates(mock, "alice");
    expect(written).toHaveLength(1);
    expect(written[0].params).toMatchObject({
      streamIds: [SCOPE_STREAM_ID],
      type: "consent/scope-update-cmc",
      content: { scopeRequestEventId: REQUEST_ID, accept: true },
    });
    expect(mock.calls.alice.some((c) => c.method === "events.getOne" && c.params.id === UPDATE_EVENT_ID)).toBe(true);
  });

  test("[SUE2] decline: writes the refuse trigger and shows the outcome on the page", async ({ page, context }) => {
    const mock = await mockScopePlatform(context);
    await page.goto(scopeUpdatePath());
    await expectProposalShown(page);
    await expect(page.getByTestId("cmc-approving-as")).toContainText("You are approving as alice.");

    await page.getByRole("button", { name: "Decline" }).click();

    // No opener and no returnUrl: the page stays open with the outcome.
    await expect(page.getByRole("heading", { name: "Scope update declined" })).toBeVisible();
    await expect(page.getByText("The scope-update request was declined.")).toBeVisible();
    const written = creates(mock, "alice");
    expect(written).toHaveLength(1);
    expect(written[0].params).toMatchObject({
      streamIds: [SCOPE_STREAM_ID],
      type: "consent/scope-update-cmc",
      content: { scopeRequestEventId: REQUEST_ID, accept: false },
    });
  });

  // The app names the account it expects; this browser holds another one.
  test("[SUE3] username= names another account: the switch block replaces Approve", async ({ page, context }) => {
    const mock = await mockScopePlatform(context);
    await page.goto(scopeUpdatePath({ username: "carol" }));
    await expectProposalShown(page);

    await expect(page.getByTestId("cmc-switch-account")).toContainText(
      "This request is for carol, but you are signed in as alice.",
    );
    await expect(page.getByRole("button", { name: "Switch account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(0);
    await expect(page.getByTestId("cmc-approving-as")).toHaveCount(0);
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE4] Switch account: /signin keeps the request, and signing in as the expected account comes back to it", async ({ page, context }) => {
    const mock = await mockScopePlatform(context);
    await page.goto(scopeUpdatePath({ username: "carol" }));
    await expect(page.getByTestId("cmc-switch-account")).toBeVisible();

    await page.getByRole("button", { name: "Switch account" }).click();
    await signInAsCarolAndReturn(page, mock, "carol");
    expect(new URL(page.url()).searchParams.get("username")).toBe("carol");

    // Answered as carol, on carol's core: alice's account wrote nothing.
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("heading", { name: "Scope update approved" })).toBeVisible();
    expect(creates(mock, "carol")).toHaveLength(1);
    expect(creates(mock, "carol")[0].params).toMatchObject({ content: { scopeRequestEventId: REQUEST_ID, accept: true } });
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE5] Not you? Switch account: signs out and comes back to the request as the new account", async ({ page, context }) => {
    const mock = await mockScopePlatform(context);
    await page.goto(scopeUpdatePath());
    await expect(page.getByTestId("cmc-approving-as")).toContainText("You are approving as alice.");

    await page.getByRole("button", { name: "Not you? Switch account" }).click();
    await signInAsCarolAndReturn(page, mock, "");

    // The session is carol's now: a reload keeps it.
    await page.reload();
    await expect(page.getByTestId("cmc-approving-as")).toContainText("You are approving as carol.");
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE6] an already answered request: no account line, nothing to answer", async ({ page, context }) => {
    const mock = await mockScopePlatform(context, { requestStatus: "accepted" });
    await page.goto(scopeUpdatePath());
    await expectProposalShown(page);

    await expect(page.getByRole("alert").filter({ hasText: "You have already answered this request. It was approved." })).toBeVisible();
    await expect(page.getByTestId("cmc-approving-as")).toHaveCount(0);
    await expect(page.getByTestId("cmc-checking-account")).toHaveCount(0);
    await expect(page.getByTestId("cmc-switch-account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Decline" })).toBeDisabled();
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE10] an already answered request with another account expected: no switch block either", async ({ page, context }) => {
    const mock = await mockScopePlatform(context, { requestStatus: "refused" });
    // The account is known (alice, not carol) before the page is checked.
    const accountRead = page.waitForResponse("https://alice.example.test/access-info");
    await page.goto(scopeUpdatePath({ username: "carol" }));
    await accountRead;
    await expectProposalShown(page);

    await expect(page.getByRole("alert").filter({ hasText: "You have already answered this request. It was declined." })).toBeVisible();
    await expect(page.getByTestId("cmc-switch-account")).toHaveCount(0);
    await expect(page.getByTestId("cmc-approving-as")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Decline" })).toBeDisabled();
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE7] an unreadable request: says so, no account line, actions disabled", async ({ page, context }) => {
    const mock = await mockScopePlatform(context, { requestErrorId: "unknown-resource" });
    await page.goto(scopeUpdatePath());

    await expect(page.getByRole("alert").filter({ hasText: "This request could not be found on your account." })).toBeVisible();
    await expect(page.getByText("Proposed permissions:")).toHaveCount(0);
    await expect(page.getByTestId("cmc-approving-as")).toHaveCount(0);
    await expect(page.getByTestId("cmc-switch-account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Decline" })).toBeDisabled();
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE8] the account is not known yet: actions disabled; past the wait, sign in again", async ({ page, context }) => {
    const mock = await mockScopePlatform(context, { accessInfo: "hang" });
    await page.clock.install();
    await page.goto(scopeUpdatePath());
    await expectProposalShown(page);

    await expect(page.getByTestId("cmc-checking-account")).toHaveText("Checking the signed-in account…");
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Decline" })).toBeDisabled();

    // The 4 s give-up (ACCOUNT_LOOKUP_WAIT_MS), on the page's clock.
    await page.clock.runFor(4000);
    await expect(page.getByTestId("cmc-switch-account")).toContainText(
      "Could not confirm which account is signed in. Sign in again to answer this request.",
    );
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByTestId("cmc-checking-account")).toHaveCount(0);

    // A name arriving after the give-up does not change the page under the user.
    const late = page.waitForResponse("https://alice.example.test/access-info");
    mock.releaseAccessInfo();
    await late;
    await expect(page.getByTestId("cmc-switch-account")).toBeVisible();
    await expect(page.getByTestId("cmc-approving-as")).toHaveCount(0);
    expect(creates(mock, "alice")).toHaveLength(0);
  });

  test("[SUE9] the account cannot be read: sign in again instead of Approve", async ({ page, context }) => {
    const mock = await mockScopePlatform(context, { accessInfo: "fail" });
    await page.goto(scopeUpdatePath());
    await expectProposalShown(page);

    await expect(page.getByTestId("cmc-switch-account")).toContainText("Could not confirm which account is signed in.");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await page.getByRole("button", { name: "Switch account" }).click();
    await signInAsCarolAndReturn(page, mock, "");
  });
});
