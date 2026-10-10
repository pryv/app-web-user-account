import { test, expect } from "@playwright/test";

/**
 * "Delete my account" (Data rights), hermetic, on both platform topologies.
 *
 * The platform serves the deletion at the root of a core
 * (`DELETE /users/{username}`), never under the user endpoint: on a DNS-style
 * platform the user host is rewritten to `/{username}/...`, on a path-style one
 * the endpoint carries `{username}/`. The app asks the register for the home
 * core (`POST {register}{username}/server`) and deletes there.
 */

const META = { apiVersion: "2.0.0-rc.46", serverTime: 1789560000, serial: "1" };

type Topology = {
  name: string;
  endpoint: string; // stored session endpoint, with the token
  endpointRoute: string; // where batch calls land
  register: string;
  api: string;
  /** Register answer, or null for a failed lookup. */
  server: string | null;
  expectedDelete: string;
};

const TOPOLOGIES: Topology[] = [
  {
    name: "DNS-style",
    endpoint: "https://tok@alice.example.test/",
    endpointRoute: "https://alice.example.test/",
    register: "https://reg.example.test/",
    api: "https://{username}.example.test/",
    server: "https://core-a.example.test/",
    expectedDelete: "https://core-a.example.test/users/alice",
  },
  {
    name: "path-style",
    endpoint: "https://tok@api.example.test/alice/",
    endpointRoute: "https://api.example.test/alice/",
    register: "https://api.example.test/reg/",
    api: "https://api.example.test/{username}/",
    server: "https://api.example.test/",
    expectedDelete: "https://api.example.test/users/alice",
  },
  {
    name: "path-style, register lookup unavailable",
    endpoint: "https://tok@api.example.test/alice/",
    endpointRoute: "https://api.example.test/alice/",
    register: "https://api.example.test/reg/",
    api: "https://api.example.test/{username}/",
    server: null,
    expectedDelete: "https://api.example.test/users/alice",
  },
];

for (const topo of TOPOLOGIES) {
  test(`delete my account: ${topo.name}`, async ({ page }) => {
    const serviceInfoUrl = topo.register + "service/info";
    await page.route("**/service/info", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ meta: META, register: topo.register, api: topo.api, access: topo.register + "access/", name: "Test platform", serial: "1" }),
      }),
    );
    await page.route("**/access-info**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ meta: META, type: "personal", user: { username: "alice" } }),
      }),
    );
    await page.route(topo.endpointRoute, (route) => {
      const body = route.request().postDataJSON() as Array<{ method: string }> | null;
      const batch = Array.isArray(body) ? body : [];
      const results = batch.map((call) =>
        call.method === "account.get"
          ? { account: { username: "alice", email: "a@example.test", language: "en" } }
          : {},
      );
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ meta: META, results }) });
    });

    const lookups: string[] = [];
    await page.route(topo.register + "alice/server", (route) => {
      lookups.push(route.request().method());
      return topo.server == null
        ? route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { id: "unknown-user" } }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ server: topo.server, alias: "alice.example.test" }) });
    });

    const deletes: Array<{ url: string; auth: string | undefined }> = [];
    await page.route("**/users/alice", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deletes.push({ url: route.request().url(), auth: route.request().headers()["authorization"] });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ meta: META, userDeletion: { username: "alice" } }),
      });
    });

    await page.addInitScript(
      ([endpoint, svc]) => {
        // Exact keys from src/lib/session.tsx.
        window.localStorage.setItem("pryv.session.apiEndpoint", endpoint);
        window.localStorage.setItem("pryv.session.serviceInfoUrl", svc);
      },
      [topo.endpoint, serviceInfoUrl],
    );

    await page.goto("/account/data");
    await expect(page.getByText("alice", { exact: true })).toBeVisible();
    await page.getByLabel("Confirm username").fill("alice");
    await page.getByRole("button", { name: "Delete my account" }).click();

    await expect(page).toHaveURL(/\/signin/);
    expect(lookups).toEqual(["POST"]);
    expect(deletes).toEqual([{ url: topo.expectedDelete, auth: "tok" }]);
  });
}
