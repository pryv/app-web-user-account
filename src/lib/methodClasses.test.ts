import { describe, it, expect } from "vitest";
import { classifyMethod, METHOD_CLASSES } from "./methodClasses";

/**
 * [MCLS] Method classes. FIXTURE is shared verbatim with the core's
 * classifier test, so the app's chart and the core's `usage` counters agree.
 */

const FIXTURE: Array<[string, string]> = [
  ["events.get", "read"],
  ["events.getOne", "read"],
  ["events.getAttachment", "read"],
  ["streams.get", "read"],
  ["accesses.checkApp", "read"],
  ["service.info", "read"],
  ["account.usernameChanges", "read"],
  ["delegations.listControlled", "read"],
  ["sharedSecrets.retrieve", "read"],
  ["getAccessInfo", "read"],
  ["events.create", "write"],
  ["events.update", "write"],
  ["events.deleteAttachment", "write"],
  ["accesses.delete", "write"],
  ["account.changePassword", "write"],
  ["account.externalIds.claim", "write"],
  ["delegations.acceptAttach", "write"],
  ["webhooks.test", "write"],
  ["account.requestPasswordReset", "write"],
  ["account.transferClaim", "write"],
  ["auth.login", "session"],
  ["auth.logout", "session"],
  ["mfa.verify", "session"],
  ["auth.hostings", "session"],
  ["callBatch", "batch"],
];

describe("[MCLS] classifyMethod", () => {
  it("[MCL1] the shared fixture", () => {
    for (const [method, cls] of FIXTURE) expect([method, classifyMethod(method)]).toEqual([method, cls]);
  });

  it("[MCL2] write extras: deactivate, erase, adminRelease, extIdRelease", () => {
    expect(classifyMethod("system.deactivateMfa")).toBe("write");
    expect(classifyMethod("system.extIdRelease")).toBe("write");
    expect(classifyMethod("account.externalIds.adminRelease")).toBe("write");
    expect(classifyMethod("account.autoDeletion.erase")).toBe("write");
  });

  it("[MCL3] OAuth audit ids are session; an unknown verb is other", () => {
    expect(classifyMethod("oauth.consent.granted")).toBe("session");
    expect(classifyMethod("sso.callback")).toBe("session");
    expect(classifyMethod("events.frobnicate")).toBe("other");
  });

  it("[MCL4] the public classes", () => {
    expect([...METHOD_CLASSES]).toEqual(["read", "write", "session", "other"]);
  });
});
