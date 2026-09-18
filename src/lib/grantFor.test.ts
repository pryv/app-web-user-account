// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { ControlledRecord } from "@pryv/delegation";
import {
  offersTargets,
  grantTargets,
  preselectedTarget,
  unavailableActAs,
  delegationHint,
  isDelegatedChild,
  openDelegatedWorkspace,
  endpointWithoutToken,
  markRequestDone,
  wasRequestDone,
} from "./grantFor";

const rec = (username: string, status: string, hostSlug = "core-b"): ControlledRecord =>
  ({ relId: "rel-" + username, controlled: { username, hostSlug }, status, requestedAt: 1 }) as ControlledRecord;

describe("[GFT] who is this access for", () => {
  it("[GFT1] is offered only when the platform runs delegation and the app does not deny it", () => {
    const on = { features: { delegation: true } };
    expect(offersTargets(on, undefined)).toBe(true);
    expect(offersTargets(on, "allow")).toBe(true);
    expect(offersTargets(on, "kiddo")).toBe(true);
    expect(offersTargets(on, "deny")).toBe(false);
    expect(offersTargets({ features: {} }, "allow")).toBe(false);
    expect(offersTargets({ features: { delegation: "true" } }, "allow")).toBe(false);
    expect(offersTargets(null, "allow")).toBe(false);
  });

  it("[GFT2] lists the signed-in account first, then active controlled accounts only", () => {
    const targets = grantTargets("parent", [rec("kid-a", "active"), rec("kid-b", "invite"), rec("kid-c", "stale"), rec("kid-d", "active", "core-x")]);
    expect(targets).toEqual([
      { username: "parent", self: true },
      { username: "kid-a", self: false, hostSlug: "core-b" },
      { username: "kid-d", self: false, hostSlug: "core-x" },
    ]);
    expect(grantTargets("parent", [])).toEqual([{ username: "parent", self: true }]);
  });

  it("[GFT3] preselects the account the app named, when offered", () => {
    const targets = grantTargets("parent", [rec("kid-a", "active")]);
    expect(preselectedTarget(targets, "kid-a").username).toBe("kid-a");
    expect(preselectedTarget(targets, "someone-else").username).toBe("parent");
    expect(preselectedTarget(targets, "allow").username).toBe("parent");
    expect(preselectedTarget(targets, undefined).username).toBe("parent");
  });

  it("[GFT8] names the account the app asked for when it is not among the choices", () => {
    const targets = grantTargets("parent", [rec("kid-a", "active"), rec("kid-b", "invite")]);
    expect(unavailableActAs(targets, "kid-b")).toBe("kid-b"); // not active: not offered
    expect(unavailableActAs(targets, "stranger")).toBe("stranger");
    for (const actAs of [undefined, "allow", "deny", "", "kid-a", "parent"]) {
      expect(unavailableActAs(targets, actAs)).toBeNull();
    }
  });

  it("[GFT4] builds the hint the server accepts: controlledUsername is the account granted on", () => {
    expect(delegationHint("kid-a", { username: "parent" })).toEqual({
      isDelegatedAccess: true,
      controlledUsername: "kid-a",
      delegate: { username: "parent" },
    });
    expect(delegationHint("kid-a", { username: "parent", hostSlug: "core-a" }).delegate).toEqual({ username: "parent", hostSlug: "core-a" });
  });

  it("[GFT5] recognises an access granted through a delegation by its lineage marker only", () => {
    expect(isDelegatedChild({ clientData: { delegation: { kind: "delegated-child" } } })).toBe(true);
    expect(isDelegatedChild({ clientData: { delegation: { kind: "delegate-pat" } } })).toBe(false);
    expect(isDelegatedChild({ clientData: { app: 1 } })).toBe(false);
    expect(isDelegatedChild({ clientData: null })).toBe(false);
    expect(isDelegatedChild(null)).toBe(false);
  });

  it("[GFT6] opens a workspace on the controlled account with the endpoint stripped of any token", async () => {
    const client = { getToken: vi.fn().mockResolvedValue({ token: "pat", apiEndpoint: "https://pat@kid-a.core.test/" }) };
    expect(await openDelegatedWorkspace(client, "kid-a")).toEqual({
      username: "kid-a",
      token: "pat",
      apiEndpoint: "https://kid-a.core.test/",
    });
    expect(client.getToken).toHaveBeenCalledWith("kid-a");
    expect(endpointWithoutToken("https://core.test/kid-a/")).toBe("https://core.test/kid-a/");
  });

  it("[GFT7] remembers, per poll URL, that this tab decided the request", () => {
    expect(wasRequestDone("https://core.test/reg/access/k9")).toBe(false);
    markRequestDone("https://core.test/reg/access/k9");
    expect(wasRequestDone("https://core.test/reg/access/k9")).toBe(true);
    expect(wasRequestDone("https://core.test/reg/access/k8")).toBe(false);
  });
});
