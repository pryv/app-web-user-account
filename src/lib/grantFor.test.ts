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
  managedOnlyOf,
  grantStep,
  creationPrefill,
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
    expect(preselectedTarget(targets, "kid-a")?.username).toBe("kid-a");
    expect(preselectedTarget(targets, "someone-else")?.username).toBe("parent");
    expect(preselectedTarget(targets, "allow")?.username).toBe("parent");
    expect(preselectedTarget(targets, undefined)?.username).toBe("parent");
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

describe("[GFM] who is this access for: an account the user manages only", () => {
  const base = {
    offers: true as boolean | null,
    listed: [rec("kid-a", "active"), rec("kid-b", "invite"), rec("kid-c", "active")] as ControlledRecord[] | null,
    selfUsername: "parent",
    actAs: "allow" as string | undefined,
    managedOnly: true,
    acting: false,
    preferred: null as string | null,
  };

  it("[GFM1] reads the echo defensively: only a boolean true asks for a managed account", () => {
    expect(managedOnlyOf({ actAsManagedOnly: true })).toBe(true);
    for (const v of [false, "true", 1, {}, [true], null, undefined]) expect(managedOnlyOf({ actAsManagedOnly: v })).toBe(false);
    expect(managedOnlyOf({})).toBe(false);
    expect(managedOnlyOf(null)).toBe(false);
  });

  it("[GFM2] lists only the active managed accounts, never the signed-in one", () => {
    const listed = [rec("kid-a", "active"), rec("kid-b", "invite"), rec("kid-d", "active", "core-x")];
    expect(grantTargets("parent", listed, { managedOnly: true })).toEqual([
      { username: "kid-a", self: false, hostSlug: "core-b" },
      { username: "kid-d", self: false, hostSlug: "core-x" },
    ]);
    expect(grantTargets("parent", [], { managedOnly: true })).toEqual([]);
    expect(grantTargets("parent", listed, { managedOnly: false })[0]).toEqual({ username: "parent", self: true });
    const step = grantStep(base);
    expect(step.kind === "choose" && step.targets.map((t) => t.username)).toEqual(["kid-a", "kid-c"]);
  });

  it("[GFM3] preselects the named account, else the one the session acted for, else none", () => {
    const targets = grantTargets("parent", [rec("kid-a", "active"), rec("kid-c", "active")], { managedOnly: true });
    expect(preselectedTarget(targets, "kid-c", "kid-a")?.username).toBe("kid-c");
    expect(preselectedTarget(targets, "allow", "kid-a")?.username).toBe("kid-a");
    expect(preselectedTarget(targets, "allow", "parent")).toBeNull();
    expect(preselectedTarget(targets, "allow")).toBeNull();
    expect(preselectedTarget(targets, "stranger")).toBeNull();
    expect(grantStep(base)).toMatchObject({ kind: "choose", selected: null, createOpen: false });
    expect(grantStep({ ...base, actAs: "kid-c" })).toMatchObject({ kind: "choose", selected: "kid-c" });
    expect(grantStep({ ...base, acting: true, preferred: "kid-a" })).toMatchObject({ kind: "choose", selected: "kid-a" });
  });

  it("[GFM4] no active managed account: the step still shows, the creation form open, pre-filled with the named account", () => {
    const none = { ...base, listed: [rec("kid-b", "invite")] };
    expect(grantStep(none)).toEqual({ kind: "choose", targets: [], selected: null, listFailed: false, createOpen: true });
    expect(grantStep({ ...none, actAs: "kiddo" })).toMatchObject({ kind: "choose", targets: [], createOpen: true });
    // The named account is offered for creation only when it is not the signed-in one.
    expect(creationPrefill([], "kiddo", "parent")).toBe("kiddo");
    expect(creationPrefill([], "parent", "parent")).toBeNull();
    expect(creationPrefill([], "allow", "parent")).toBeNull();
    // A failed listing still offers the creation, and says why.
    expect(grantStep({ ...base, listed: null })).toMatchObject({ kind: "choose", targets: [], listFailed: true, createOpen: true });
    // Managed accounts to choose from: the form stays closed unless the app named another one.
    expect(grantStep({ ...base, actAs: "kiddo" })).toMatchObject({ kind: "choose", createOpen: true });
  });

  it("[GFM5] when no managed account can be used, never the signed-in account: unavailable, with the cause", () => {
    expect(grantStep({ ...base, offers: false })).toEqual({ kind: "unavailable", cause: "delegation-off" });
    expect(grantStep({ ...base, offers: null })).toEqual({ kind: "unavailable", cause: "list-failed" });
    // A session acting for another account cannot create one.
    expect(grantStep({ ...base, acting: true, listed: null })).toEqual({ kind: "unavailable", cause: "list-failed" });
    expect(grantStep({ ...base, acting: true, listed: [] })).toEqual({ kind: "unavailable", cause: "none" });
  });

  it("[GFM6] (guard) without managedOnly the step is as before", () => {
    const off = { ...base, managedOnly: false };
    expect(grantStep({ ...off, offers: false })).toEqual({ kind: "consent" });
    expect(grantStep({ ...off, offers: null })).toEqual({ kind: "consent" });
    expect(grantStep({ ...off, actAs: undefined, listed: [] })).toEqual({ kind: "consent" });
    expect(grantStep({ ...off, actAs: undefined, listed: null })).toEqual({ kind: "consent" });
    expect(grantStep({ ...off, acting: true, listed: null })).toEqual({ kind: "consent" });
    expect(grantStep(off)).toMatchObject({ kind: "choose", selected: "parent", createOpen: false });
    expect(grantStep({ ...off, listed: [] })).toMatchObject({ kind: "choose", targets: [{ username: "parent", self: true }] });
    expect(grantStep({ ...off, listed: null })).toMatchObject({ kind: "choose", listFailed: true, createOpen: false });
  });
});
