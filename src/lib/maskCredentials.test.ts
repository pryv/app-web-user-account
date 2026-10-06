import { describe, it, expect } from "vitest";
import { maskCredentials, maskUrlCredentials } from "./maskCredentials";

describe("[MCRD] credentials masked on screen", () => {
  it("[MCR1] a consent grant's client data, as the core stamps it: every token-bearing endpoint masked, the rest as is", () => {
    const clientData = {
      cmc: {
        role: "counterparty",
        appCode: "carer-app",
        scopeStreamId: ":_cmc:apps:carer-app:study-1",
        offerEventId: "offer-1",
        acceptEventId: "acc-1",
        features: { chat: { type: "user" } },
        counterparty: {
          username: "alice",
          host: "core.example.com",
          apiEndpoint: "https://c3x9tok3n@core.example.com/alice/",
          remoteChatStreamId: ":_cmc:apps:carer-app:chats:bob",
        },
        backChannelApiEndpoint: "https://bk7tok3n@core.example.com/alice/",
      },
      delegation: { kind: "invite-capability", relId: "rel-1", capabilityUrl: "https://cap4tok3n@core.example.com/kiddo/" },
    };
    const shown = maskCredentials(clientData);
    expect(shown.cmc.counterparty.apiEndpoint).toBe("https://***@core.example.com/alice/");
    expect(shown.cmc.backChannelApiEndpoint).toBe("https://***@core.example.com/alice/");
    expect(shown.delegation.capabilityUrl).toBe("https://***@core.example.com/kiddo/");
    const text = JSON.stringify(shown);
    for (const token of ["c3x9tok3n", "bk7tok3n", "cap4tok3n"]) expect(text).not.toContain(token);
    // Everything else, unchanged; the original is not touched.
    expect({ ...shown.cmc, counterparty: undefined, backChannelApiEndpoint: undefined }).toEqual({
      ...clientData.cmc,
      counterparty: undefined,
      backChannelApiEndpoint: undefined,
    });
    expect(shown.cmc.counterparty.remoteChatStreamId).toBe(":_cmc:apps:carer-app:chats:bob");
    expect(clientData.cmc.counterparty.apiEndpoint).toBe("https://c3x9tok3n@core.example.com/alice/");
  });

  it("[MCR2] at any depth, in objects and arrays", () => {
    expect(maskCredentials({ a: { b: [{ c: ["x", "https://t@h.test/u/"] }] } })).toEqual({
      a: { b: [{ c: ["x", "https://***@h.test/u/"] }] },
    });
    expect(maskCredentials(["https://u:p@h.test/", 1, null, true])).toEqual(["https://***@h.test/", 1, null, true]);
  });

  it("[MCR3] strings that carry no credential are left as they are", () => {
    for (const s of [
      "alice@example.com",
      "user@host",
      "mailto:alice@example.com",
      "https://core.example.com/alice/",
      "https://core.example.com/alice/a@b?x=y@z",
      ":_cmc:apps:carer-app",
      "",
    ]) {
      expect(maskUrlCredentials(s)).toBe(s);
    }
  });

  it("[MCR4] user and password both masked; a backslash spelling too; a URL inside a text too", () => {
    expect(maskUrlCredentials("https://user:secret@core.example.com/alice/")).toBe("https://***@core.example.com/alice/");
    expect(maskUrlCredentials("https://:s3cret@core.example.com/alice/")).toBe("https://***@core.example.com/alice/");
    expect(maskUrlCredentials("https:\\\\tok@core.example.com\\alice\\")).not.toContain("tok");
    expect(maskUrlCredentials("could not reach https://tok3n@core.example.com/alice/ (503)")).toBe(
      "could not reach https://***@core.example.com/alice/ (503)",
    );
    // A text that starts like a scheme ("unreachable:") parses as an opaque URL: the URL inside is still masked.
    expect(maskUrlCredentials("unreachable: could not reach https://tok3n@core.example.com/alice/")).toBe(
      "unreachable: could not reach https://***@core.example.com/alice/",
    );
  });
});
