import { describe, it, expect, vi } from "vitest";
import {
  fetchCurrentValidation,
  validationChange,
  stampedValidationLevel,
  MAX_CLIENT_IDS_PER_REQUEST,
} from "./currentValidation";

/**
 * [CURV] The current validation of the account's apps (`POST
 * /oauth2/clients/validation`): asked at the core of the session's endpoint
 * with its personal token, at most 50 ids per request; a core without the
 * route or any failure is no answer; malformed entries are dropped; what
 * changed since consent.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ENDPOINT = "https://tok%2Fen@core.example.com/alice/";

describe("[CURV] current validation", () => {
  it("[CURV1] posts the ids with the username and the endpoint's token to the core root, and reads the answer", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        clients: {
          a: { level: "appValidated", served: true },
          b: { level: "publisherValidated", publisher: { name: "Acme", validated: true }, served: false },
          bad: { level: "superValidated", served: true },
          noServed: { level: "nonValidated" },
        },
      }),
    );
    const r = await fetchCurrentValidation({ apiEndpoint: ENDPOINT, username: "alice", clientIds: ["a", "b", "a"], fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://core.example.com/oauth2/clients/validation");
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice", userToken: "tok/en", clientIds: ["a", "b"] });
    expect([...r!.keys()]).toEqual(["a", "b"]);
    expect(r!.get("b")).toEqual({ level: "publisherValidated", publisher: { name: "Acme", validated: true }, validatedAt: null, served: false });
  });

  it("[CURV2] more than 50 ids go in several requests", async () => {
    const ids = Array.from({ length: MAX_CLIENT_IDS_PER_REQUEST + 3 }, (_, i) => "c" + i);
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string).clientIds as string[];
      return jsonResponse(200, { clients: Object.fromEntries(sent.map((id) => [id, { level: "appValidated", served: true }])) });
    });
    const r = await fetchCurrentValidation({ apiEndpoint: ENDPOINT, username: "alice", clientIds: ids, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string).clientIds).toHaveLength(50);
    expect(r!.size).toBe(53);
  });

  it("[CURV3] a core without the route (404), a refusal, a network error or a malformed answer: no answer", async () => {
    for (const fetchFn of [
      async () => jsonResponse(404, { error: "not found" }),
      async () => jsonResponse(403, { error: "access_denied" }),
      async () => {
        throw new Error("offline");
      },
      async () => jsonResponse(200, { clients: [] }),
    ]) {
      expect(await fetchCurrentValidation({ apiEndpoint: ENDPOINT, username: "alice", clientIds: ["a"], fetchFn })).toBeNull();
    }
    // No token in the endpoint: nothing is asked.
    const never = vi.fn();
    expect(await fetchCurrentValidation({ apiEndpoint: "https://core.example.com/alice/", username: "alice", clientIds: ["a"], fetchFn: never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
    // No id: an empty answer, nothing asked.
    expect((await fetchCurrentValidation({ apiEndpoint: ENDPOINT, username: "alice", clientIds: [], fetchFn: never }))!.size).toBe(0);
  });

  it("[CURV4] what changed since consent", () => {
    const cur = (level: "nonValidated" | "publisherValidated" | "appValidated", served = true) => ({ level, publisher: null, validatedAt: null, served });
    expect(validationChange("appValidated", null)).toBeNull();
    expect(validationChange("appValidated", cur("appValidated"))).toBeNull();
    expect(validationChange(null, cur("nonValidated"))).toBeNull();
    expect(validationChange("appValidated", cur("appValidated", false))).toBe("notServed");
    expect(validationChange("appValidated", cur("publisherValidated"))).toBe("lowered");
    expect(validationChange("nonValidated", cur("publisherValidated"))).toBe("raised");
  });

  it("[CURV5] the level stamped at consent", () => {
    expect(stampedValidationLevel({ clientData: { oauth: { client: { validation: { level: "publisherValidated" } } } } })).toBe("publisherValidated");
    expect(stampedValidationLevel({ clientData: { oauth: { client: { validation: { level: "other" } } } } })).toBeNull();
    expect(stampedValidationLevel({ clientData: null })).toBeNull();
    expect(stampedValidationLevel(undefined)).toBeNull();
  });
});
