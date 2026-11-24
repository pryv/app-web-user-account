import { describe, it, expect, vi } from "vitest";
import {
  changeUsername,
  endpointForUsername,
  getUsernameChanges,
  refusalOf,
  UsernameChangeError,
} from "./usernameChange";
import type { PryvConnection } from "./sessionStore";

/**
 * [UNCH] Username change calls: the counts (null when the platform does not
 * answer them), the change and its refusals, and the session endpoint under
 * the new name.
 */

function conn(answer: unknown, extra: Record<string, unknown> = {}): PryvConnection {
  return {
    apiEndpoint: "https://tok%2Fx@core.example.com/alice/",
    api: vi.fn(async () => [answer]),
    service: { info: async () => ({}) },
    ...extra,
  } as unknown as PryvConnection;
}

describe("[UNCH] username change calls", () => {
  it("[UNC1] counts from account.usernameChanges", async () => {
    const c = conn({ usernameChangesUsed: 1, usernameChangesLimit: 2, usernameChangesRemaining: 1 });
    expect(await getUsernameChanges(c)).toEqual({ used: 1, limit: 2, remaining: 1 });
    expect(c.api).toHaveBeenCalledWith([{ method: "account.usernameChanges", params: {} }]);
  });

  it("[UNC2] null on an error answer, a missing field or a throw", async () => {
    expect(await getUsernameChanges(conn({ error: { id: "unknown-method" } }))).toBeNull();
    expect(await getUsernameChanges(conn({ usernameChangesUsed: 1 }))).toBeNull();
    const throwing = conn(null, { api: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await getUsernameChanges(throwing)).toBeNull();
  });

  it("[UNC3] refusals read from the error id and data", () => {
    expect(refusalOf({ id: "item-already-exists" })).toBe("taken");
    expect(refusalOf({ id: "invalid-parameters-format" })).toBe("format");
    expect(refusalOf({ id: "forbidden" })).toBe("personal");
    expect(refusalOf({ id: "invalid-operation", data: { usernameChangesUsed: 2, usernameChangesLimit: 2 } })).toBe("limit");
    expect(refusalOf({ id: "invalid-operation", data: { newUsername: "admin" } })).toBe("reserved");
    expect(refusalOf({ id: "invalid-operation", message: "The new username is identical to the current one." })).toBe("same");
    expect(refusalOf({ id: "invalid-operation", message: "another change in progress" })).toBe("other");
    expect(refusalOf({ id: "unexpected-error" })).toBe("other");
  });

  it("[UNC4] a change answers the new name, the changes left and the warnings", async () => {
    const c = conn({
      account: { username: "bobby" },
      usernameChangesRemaining: 0,
      warnings: [{ step: "webhooks", message: "later" }],
    });
    expect(await changeUsername(c, "bobby")).toEqual({
      username: "bobby",
      remaining: 0,
      warnings: [{ step: "webhooks", message: "later" }],
    });
    expect(c.api).toHaveBeenCalledWith([{ method: "account.changeUsername", params: { newUsername: "bobby" } }]);
  });

  it("[UNC5] a refused change throws a UsernameChangeError", async () => {
    const c = conn({ error: { id: "item-already-exists", message: "exists" } });
    await expect(changeUsername(c, "taken-name")).rejects.toSatisfy(
      (e: unknown) => e instanceof UsernameChangeError && e.refusal === "taken",
    );
  });

  it("[UNC6] the endpoint under the new name keeps the session token", async () => {
    const apiEndpointFor = vi.fn(async (u: string, t: string) => `https://${encodeURIComponent(t)}@core.example.com/${u}/`);
    const c = conn(null, { service: { info: async () => ({}), apiEndpointFor } });
    expect(await endpointForUsername(c, "bobby")).toBe("https://tok%2Fx@core.example.com/bobby/");
    expect(apiEndpointFor).toHaveBeenCalledWith("bobby", "tok/x");
  });

  it("[UNC7] no endpoint without a token or a service that builds one", async () => {
    expect(await endpointForUsername(conn(null), "bobby")).toBeNull();
    const noToken = conn(null, {
      apiEndpoint: "https://core.example.com/alice/",
      service: { info: async () => ({}), apiEndpointFor: async () => "x" },
    });
    expect(await endpointForUsername(noToken, "bobby")).toBeNull();
  });
});
