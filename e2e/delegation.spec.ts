import { test, expect } from "@playwright/test";

/**
 * Account delegation, hermetic.
 *
 * The one that matters most is the banner. A delegate token is
 * owner-equivalent and `user.username` IS the controlled account, so if
 * `DelegatedSessionBanner` ever stops rendering, nothing else on any screen
 * tells someone they are editing a relative's account rather than their own.
 * That regression would be invisible to every other test in this suite, and to
 * a human clicking through as themselves.
 *
 * The full-control warning is checked for substance, not wording: it must say a
 * delegate can log in directly and remove other delegates, and must NOT claim
 * that is impossible (an earlier copy did, so this guards against regressing to
 * a comfortable lie).
 */

/**
 * Every mocked core response MUST carry `meta`. The pryv client validates it
 * and throws "Cannot find .meta in response" otherwise, which surfaces as a
 * silently missing banner rather than an obvious failure, because the banner
 * treats an unreadable access-info as "not a delegated session". Do not drop
 * it from a new mock.
 */
const META = { apiVersion: "2.0.0-pre.4", serverTime: 1789560000, serial: "1" };

const SERVICE_INFO = {
  register: "https://reg.example.test/",
  api: "https://{username}.example.test/",
  access: "https://reg.example.test/access/",
  name: "Test platform",
  serial: "1",
  features: { emailVerification: { atRegistration: false, onAccount: true } },
};

/** A signed-in session plus the delegation lists, with no platform behind them. */
async function signedInWithDelegation(
  page: import("@playwright/test").Page,
  opts: {
    delegates?: unknown[];
    controlled?: unknown[];
    /** When set, access-info reports a DELEGATED session. */
    actingAs?: { controlled: string; delegate: string };
    /** `accesses.get` answer. */
    accesses?: unknown[];
    /** `accesses.get` answer once a delegate has been detached (default: `accesses`). */
    accessesAfterDetach?: unknown[];
    /** `accesses.get` fails (a per-call error inside the batch). */
    accessesError?: boolean;
    /** `events.getOne` answers, by event id. */
    events?: Record<string, unknown>;
  } = {},
) {
  await page.route("**/service/info", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SERVICE_INFO) }),
  );

  const accessInfo: Record<string, unknown> = {
    type: "personal",
    user: { username: opts.actingAs?.controlled ?? "alice" },
  };
  if (opts.actingAs) {
    accessInfo.delegation = {
      isDelegatedAccess: true,
      controlledUsername: opts.actingAs.controlled,
      delegate: { username: opts.actingAs.delegate, hostSlug: "example-test" },
    };
  }
  await page.route("**/access-info**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, ...accessInfo }),
    }),
  );

  // The batch endpoint serves account.get and the delegations.* calls: the
  // pryv client sends every `@pryv/delegation` method as a one-call batch
  // (`connection.apiOne`), so the lists are answered here, by method id. A
  // batch of several calls gets one result per call.
  const methods: string[] = [];
  const calls: Array<{ method: string; params?: Record<string, unknown>; url?: string }> = [];
  let detached = false;
  await page.route("https://*.example.test/", async (route) => {
    const body = route.request().postDataJSON() as Array<{ method: string; params?: Record<string, unknown> }> | null;
    const batch = Array.isArray(body) && body.length > 0 ? body : [{ method: "" }];
    for (const call of batch) {
      methods.push(call.method);
      calls.push({ ...call, url: route.request().url() });
    }
    const results = batch.map((call) => answer(call.method, call.params ?? {}));
    if (results.some((r) => r == null)) {
      return route.fulfill({ status: 500, contentType: "text/plain", body: "e2e harness: no answer for " + batch.map((c) => c.method).join(", ") });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ meta: META, results }),
    });
  });

  function answer(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "account.get":
        return { account: { username: "alice", email: "a@example.test", language: "en" } };
      case "delegations.listDelegates":
        return { delegates: opts.delegates ?? [] };
      case "delegations.listControlled":
        return { controlled: opts.controlled ?? [] };
      case "delegations.createAccount":
        return {
          delegation: { relId: "rel1", status: "active" },
          apiEndpoint: "https://kid.example.test/",
        };
      case "delegations.getToken":
        return { token: "kid-pat", apiEndpoint: "https://kid-pat@kiddo.example.test/" };
      case "delegations.requestAttach":
        return {
          delegation: { relId: "rel2", delegate: { username: "bob" }, status: "invite", requestedAt: 1 },
        };
      case "delegations.detachDelegate":
        detached = true;
        return {};
      case "accesses.get":
        if (opts.accessesError) return { error: { id: "unexpected-error", message: "e2e: accesses unavailable" } };
        return { accesses: (detached ? opts.accessesAfterDetach : undefined) ?? opts.accesses ?? [] };
      case "events.get":
        return { events: [] };
      case "streams.get":
        return { streams: [] };
      case "events.getOne": {
        const event = opts.events?.[String(params.id)];
        return event != null ? { event } : { error: { id: "unknown-resource", message: "no such event" } };
      }
      default:
        // Loud: an unanswered method used to get `{}`, which the client
        // reads as a failure, so tests passed against an error page.
        return null;
    }
  }

  // Seed a session so the account guard does not bounce us to /signin.
  await page.addInitScript(() => {
    // Exact keys from src/lib/session.tsx — a near-miss here renders nothing
    // and every assertion below fails for the wrong reason.
    window.localStorage.setItem("pryv.session.apiEndpoint", "https://tok@alice.example.test/");
    window.localStorage.setItem("pryv.session.serviceInfoUrl", "https://reg.example.test/service/info");
  });

  /** Batch method ids the page sent, in order, and the calls with their params. */
  return { methods, calls };
}

test.describe("delegated-session banner", () => {
  test("renders on an account route when access-info marks the session delegated", async ({ page }) => {
    await signedInWithDelegation(page, { actingAs: { controlled: "kid", delegate: "parent" } });
    await page.goto("/account/profile");
    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("kid");
    await expect(banner).toContainText("parent");
  });

  test("renders outside the account section too", async ({ page }) => {
    await signedInWithDelegation(page, { actingAs: { controlled: "kid", delegate: "parent" } });
    await page.goto("/change-password");
    const banner = page.getByRole("status");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("kid");
  });

  test("is ABSENT on an ordinary personal session", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/profile");
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
    await expect(page.getByTestId("delegated-session-banner")).toHaveCount(0);
  });
});

test.describe("/account/delegation", () => {
  test("shows the three sections and the full-control warning", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");

    await expect(page.getByRole("heading", { name: "My delegates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Accounts I manage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a managed account" })).toBeVisible();

    // Substance of the warning, not its exact wording.
    const warning = page.getByText("A delegate has full control of this account:");
    await expect(warning).toBeVisible();
    const body = page.locator("ul", { hasText: "read and change everything" });
    await expect(body).toContainText("log in to the account directly");
    await expect(body).toContainText("remove other delegates");
    await expect(body).toContainText("audit trail");
    // It must never claim co-delegate eviction is impossible.
    await expect(body).not.toContainText("impossible");
  });

  test("invites are rejected before the network when the username is invalid", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");
    await page.getByLabel("Delegate username").fill("x");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid username" })).toBeVisible();
  });

  test("[DLG1] leads with creation: Create, Accounts I manage, My delegates", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation");
    const sections = page.getByRole("heading", { level: 2 });
    await expect(sections).toHaveText(["Create a managed account", "Accounts I manage", "My delegates"]);
    // The lists loaded (empty), and no load error sits above the sections.
    await expect(page.getByText("You do not manage any accounts.")).toBeVisible();
    await expect(page.getByText("No delegates.")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("[DLG2] ?create=1 focuses the creation form", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation?create=1");
    await expect(page.locator("#managed-username")).toBeFocused();
  });

  test("[DLG3] #create focuses the creation form too", async ({ page }) => {
    await signedInWithDelegation(page, {});
    await page.goto("/account/delegation#create");
    await expect(page.locator("#managed-username")).toBeFocused();
  });

  test("[DLG4] after a creation, a way on to the app that sent the user", async ({ page }) => {
    const { methods } = await signedInWithDelegation(page, {});
    await page.goto(
      "/account/delegation?backUrl=" + encodeURIComponent("https://app.example.test/") + "&backLabel=App",
    );
    // Not offered before a creation.
    await expect(page.getByRole("heading", { name: "Create a managed account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to App" })).toHaveCount(0);

    await page.locator("#managed-username").fill("kid-one");
    await page.getByRole("button", { name: "Create managed account" }).click();

    const notice = page.getByRole("alert").filter({ hasText: "Account kid-one created" });
    await expect(notice).toBeVisible();
    const link = notice.getByRole("link", { name: "Continue to App" });
    await expect(link).toHaveAttribute("href", "https://app.example.test/");
    // The host is shown next to the label (anti-phishing cue).
    await expect(notice).toContainText("(app.example.test)");
    // Brought into view with the focus on it (the notice sits above the form).
    await expect(link).toBeFocused();
    expect(methods).toContain("delegations.createAccount");

    // Only a creation offers the way on: another notice replaces it.
    await page.locator("#delegate-username").fill("bobby");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invitation sent to bobby" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to App" })).toHaveCount(0);
    expect(methods).toContain("delegations.requestAttach");
  });

  test("[DLG5] a signed-out visit keeps ?create=1 through the sign-in bounce", async ({ page }) => {
    await page.goto("/account/delegation?create=1");
    await expect(page).toHaveURL(/\/signin\?.*returnTo=[^&]*create%3D1/);
  });

  test("[DLG6] a link to a managed account's access: Open as, then the access as that account", async ({ page }) => {
    const { methods, calls } = await signedInWithDelegation(page, {
      controlled: [{ relId: "rel-kid", controlled: { username: "kiddo", hostSlug: "example-test" }, status: "active", activatedAt: 1789000000 }],
      accesses: [{ id: "acc-1", name: "kid-app", type: "app", permissions: [] }],
    });
    await page.goto("/account/audit-access/acc-1?as=kiddo");
    const offer = page.getByRole("heading", { name: /Open as kiddo\?/ });
    await expect(offer).toBeVisible();
    await expect(page).not.toHaveURL(/as=kiddo/);
    expect(methods).not.toContain("accesses.get");
    expect(methods).not.toContain("delegations.getToken");

    await page.getByRole("button", { name: "Open as kiddo" }).click();
    const banner = page.getByRole("status");
    await expect(banner).toContainText("kiddo");
    await expect(banner).toContainText("alice");
    await expect(offer).toHaveCount(0);
    await expect(page.getByText("kid-app")).toBeVisible();
    expect(methods.filter((m) => m === "delegations.getToken")).toHaveLength(1);
    // The details came from the managed account's core.
    const reads = calls.filter((c) => c.method === "accesses.get");
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) expect(c.url).toContain("kiddo.example.test");
  });

  const BOB = { relId: "rel-bob", delegate: { username: "bob" }, status: "active", activatedAt: 1789000000 };
  const consentGrant = (id: string, relId: string, requester: string) => ({
    id,
    name: "grant-" + id,
    type: "shared",
    created: 1789100000,
    permissions: [{ streamId: "diary", level: "read" }],
    clientData: {
      cmc: { role: "counterparty", acceptEventId: "ev-" + id, counterparty: { username: requester, host: "peer.example.test" } },
      delegation: { kind: "delegated-child", relId, delegate: { username: "bob" }, viaAccessId: "pat" },
    },
  });

  test("[DKP4] removing a delegate that gave no consent: no review, a plain detach", async ({ page }) => {
    const { calls } = await signedInWithDelegation(page, {
      delegates: [BOB],
      accesses: [consentGrant("other", "rel-someone-else", "doctor"), { id: "plain", name: "app", type: "app", clientData: null }],
    });
    await page.goto("/account/delegation");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Delegate removed." })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.find((c) => c.method === "delegations.detachDelegate")?.params).toEqual({ username: "bob" });
  });

  test("[DKP5] removing a delegate that gave consents: review, keep one, withdraw one", async ({ page }) => {
    const { calls } = await signedInWithDelegation(page, {
      delegates: [BOB],
      accesses: [
        consentGrant("g1", "rel-bob", "doctor"),
        consentGrant("g2", "rel-bob", "study"),
        consentGrant("other", "rel-someone-else", "lab"),
      ],
      events: { "ev-g1": { id: "ev-g1", type: "consent/accept-cmc", content: { approvedBy: { delegate: { username: "bob" }, relId: "rel-bob" } } } },
    });
    await page.goto("/account/delegation");
    await page.getByRole("button", { name: "Remove" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Remove bob: review the consents they gave");
    const rows = dialog.getByTestId("detach-review-grant");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Requested by doctor (peer.example.test)");
    await expect(rows.nth(0)).toContainText("Approved by bob");
    await expect(rows.nth(1)).toContainText("Requested by study (peer.example.test)");
    // nothing is decided for the user
    const confirm = dialog.getByRole("button", { name: "Remove delegate" });
    await expect(confirm).toBeDisabled();
    expect(calls.some((c) => c.method === "delegations.detachDelegate")).toBe(false);

    await rows.nth(0).getByRole("radio", { name: /Keep/ }).check();
    await expect(confirm).toBeDisabled();
    await rows.nth(1).getByRole("radio", { name: /Withdraw/ }).check();
    await confirm.click();

    await expect(page.getByRole("alert").filter({ hasText: "Consents kept: 1. Consents withdrawn: 1." })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(calls.find((c) => c.method === "delegations.detachDelegate")?.params).toEqual({ username: "bob", keepAccessIds: ["g1"] });
  });

  test("[DKP6] a core that cannot keep: the page reports the consents as withdrawn", async ({ page }) => {
    await signedInWithDelegation(page, {
      delegates: [BOB],
      accesses: [consentGrant("g1", "rel-bob", "doctor"), consentGrant("g2", "rel-bob", "study")],
      accessesAfterDetach: [],
    });
    await page.goto("/account/delegation");
    await page.getByRole("button", { name: "Remove" }).click();
    const rows = page.getByRole("dialog").getByTestId("detach-review-grant");
    await rows.nth(0).getByRole("radio", { name: /Keep/ }).check();
    await rows.nth(1).getByRole("radio", { name: /Withdraw/ }).check();
    await page.getByRole("button", { name: "Remove delegate" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "cannot keep a delegate's consents yet" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Consents kept: 0. Consents withdrawn: 2." })).toBeVisible();
  });

  test("[DKP8] the consents cannot be listed: an error, no dialog, no detach", async ({ page }) => {
    const { calls } = await signedInWithDelegation(page, { delegates: [BOB], accessesError: true });
    await page.goto("/account/delegation");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "nothing was removed" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls.some((c) => c.method === "delegations.detachDelegate")).toBe(false);
  });
});

/**
 * `/auth` on a platform running delegation, for a request that names `actAs`:
 * a carer who manages no account yet creates the child's account from the
 * "who is this for?" step, continues for it, and grants the app access there.
 */
test.describe("[GFC] /auth: create the managed account from the grant-for step", () => {
  const POLL = "https://reg.example.test/reg/access/gfc1";
  const PERMS = [{ streamId: "diary", defaultName: "Diary", level: "read" }];

  test("[GFC7] sign in, create, continue for the new account, accept: the answer names it", async ({ page }) => {
    const { methods } = await signedInWithDelegation(page, { controlled: [] });
    await page.route("**/service/info", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...SERVICE_INFO, features: { ...SERVICE_INFO.features, delegation: true } }),
      }),
    );
    const posted: Array<Record<string, unknown>> = [];
    await page.route(POLL, (route) => {
      if (route.request().method() === "POST") {
        posted.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ACCEPTED" }) });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "NEED_SIGNIN", requestingAppId: "kid-app", requestedPermissions: PERMS, actAs: "allow" }),
      });
    });
    const kidCalls: Array<{ url: string; auth: string | null }> = [];
    await page.route("https://kiddo.example.test/accesses/check-app", (route) => {
      kidCalls.push({ url: route.request().url(), auth: route.request().headers()["authorization"] ?? null });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ meta: META, checkedPermissions: PERMS }) });
    });
    await page.route("https://kiddo.example.test/accesses", (route) => {
      kidCalls.push({ url: route.request().url(), auth: route.request().headers()["authorization"] ?? null });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ meta: META, access: { id: "kid-access", token: "kid-app-token", type: "app", permissions: PERMS } }),
      });
    });

    await page.goto(
      "/auth?poll=" + encodeURIComponent(POLL) + "&pryvServiceInfoUrl=" + encodeURIComponent("https://reg.example.test/service/info"),
    );
    await page.getByRole("button", { name: "Continue as alice" }).click();

    // One choice (the carer's own account) and the creation offer.
    await expect(page.getByText("Grant kid-app access to:")).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(1);
    await page.getByRole("button", { name: "Create an account for someone you look after" }).click();
    await expect(page.getByText("A delegate has full control of this account:")).toBeVisible();
    await page.locator("#managed-username").fill("kiddo");
    await page.getByRole("button", { name: "Create managed account" }).click();

    // Added and selected; nothing continues on its own.
    await expect(page.getByText("Account kiddo created and selected.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /kiddo/ })).toBeChecked();
    expect(methods).toContain("delegations.createAccount");
    expect(methods).not.toContain("delegations.getToken");

    await page.getByRole("button", { name: "Continue for kiddo" }).click();
    await expect(page.getByText(/is requesting permission/)).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();

    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0].status).toBe("ACCEPTED");
    expect(posted[0].username).toBe("kiddo");
    expect(posted[0].delegation).toEqual({ isDelegatedAccess: true, controlledUsername: "kiddo", delegate: { username: "alice" } });
    // The access on the new account was minted with the delegate token, which never reaches the answer.
    expect(kidCalls.map((c) => c.auth)).toEqual(["kid-pat", "kid-pat"]);
    expect(JSON.stringify(posted[0])).not.toContain("kid-pat");
  });
});
