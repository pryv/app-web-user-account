import { describe, it, expect, vi } from "vitest";
import { claimExternalId, externalIdOf, lookupExternalId, namespaceHolding, registrationExternalId } from "./externalId";

/** [EXID] Reading an access request's external id, the lookup and the claim. */

const ID = { namespace: "clinic-a", blindedValue: "bv-1" };

function answering(status: number, body: unknown = {}) {
  return vi.fn(async () => ({ status, ok: status < 300, json: async () => body }) as Response);
}

describe("[EXID] external ids", () => {
  it("[EXID1] reads the poll's external id; label defaults to the namespace, forced reads as such", () => {
    expect(externalIdOf({ externalId: { namespace: "n", label: "N", blindedValue: "v", mode: "hint" } })).toEqual({
      namespace: "n",
      label: "N",
      blindedValue: "v",
      mode: "hint",
    });
    expect(externalIdOf({ externalId: { namespace: "n", blindedValue: "v", mode: "forced" } })).toEqual({
      namespace: "n",
      label: "n",
      blindedValue: "v",
      mode: "forced",
    });
    expect(externalIdOf({ externalId: { namespace: "n", blindedValue: "v" } })?.mode).toBe("hint");
    expect(externalIdOf({})).toBeNull();
    expect(externalIdOf(null)).toBeNull();
    expect(externalIdOf({ externalId: { namespace: "", blindedValue: "v" } })).toBeNull();
    expect(externalIdOf({ externalId: { namespace: "n", blindedValue: 3 } })).toBeNull();
  });

  it("[EXID2] lookup: 200 claimed, 404 unclaimed, anything else unknown; POST to the register, value in the body", async () => {
    const ok = answering(200, { server: "https://core.test/" });
    expect(await lookupExternalId("https://reg.test", ID, ok)).toBe("claimed");
    expect(ok).toHaveBeenCalledWith("https://reg.test/ext-id/cores", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(ID);
    expect(await lookupExternalId("https://core.test/reg/", ID, answering(404))).toBe("unclaimed");
    expect(await lookupExternalId("https://reg.test/", ID, answering(429))).toBe("unknown");
    const down = vi.fn(async () => {
      throw new TypeError("down");
    });
    expect(await lookupExternalId("https://reg.test/", ID, down)).toBe("unknown");
  });

  it("[EXID3] claim: 201/200 linked, 409 by reason, 429 rate-limited, other or no answer failed", async () => {
    const created = answering(201);
    expect(await claimExternalId("https://alice.core.test/", "pat", ID, created)).toBe("linked");
    const [url, init] = created.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://alice.core.test/account/external-ids");
    expect((init.headers as Record<string, string>).Authorization).toBe("pat");
    expect(await claimExternalId("https://alice.core.test/", "pat", ID, answering(200))).toBe("linked");
    const taken = (reason: string) => answering(409, { error: { id: "external-id-already-claimed", data: { reason } } });
    expect(await claimExternalId("https://a.test/", "pat", ID, taken("value-taken"))).toBe("value-taken");
    expect(await claimExternalId("https://a.test/", "pat", ID, taken("namespace-taken"))).toBe("namespace-taken");
    expect(await claimExternalId("https://a.test/", "pat", ID, answering(409, null))).toBe("value-taken");
    expect(await claimExternalId("https://a.test/", "pat", ID, answering(429))).toBe("rate-limited");
    expect(await claimExternalId("https://a.test/", "pat", ID, answering(500))).toBe("failed");
    const down = vi.fn(async () => {
      throw new TypeError("down");
    });
    expect(await claimExternalId("https://a.test/", "pat", ID, down)).toBe("failed");
  });

  it("[EXID4] the registration field drops the label", () => {
    expect(registrationExternalId({ namespace: "n", label: "N", blindedValue: "v", mode: "hint" })).toEqual({
      namespace: "n",
      blindedValue: "v",
      mode: "hint",
    });
  });

  it("[EXID5] namespace holding: GET the account's list with the personal token, no value sent", async () => {
    const list = answering(200, { externalIds: [{ namespace: "other", claimedAt: 1 }, { namespace: "clinic-a", claimedAt: 2 }] });
    expect(await namespaceHolding("https://a.test", "pat", "clinic-a", list)).toBe("holds");
    const [url, init] = list.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://a.test/account/external-ids");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("pat");
    expect(init.body).toBeUndefined();
    expect(await namespaceHolding("https://a.test/", "pat", "clinic-a", answering(200, { externalIds: [] }))).toBe("none");
    expect(await namespaceHolding("https://a.test/", "pat", "clinic-a", answering(200, {}))).toBe("unknown");
    expect(await namespaceHolding("https://a.test/", "pat", "clinic-a", answering(403))).toBe("unknown");
    const down = vi.fn(async () => {
      throw new TypeError("down");
    });
    expect(await namespaceHolding("https://a.test/", "pat", "clinic-a", down)).toBe("unknown");
  });
});
