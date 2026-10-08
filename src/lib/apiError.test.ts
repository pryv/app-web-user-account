import { describe, it, expect } from "vitest";
import { apiErrorIds, loggableError, redactUrls } from "./apiError";

describe("[APIR] error ids of a raw REST body", () => {
  it("[APIR1] reads error.id and error.data.id, in that order", () => {
    expect(apiErrorIds(JSON.stringify({ error: { id: "invalid-step-up", message: "x" } }))).toEqual(["invalid-step-up"]);
    expect(apiErrorIds(JSON.stringify({ error: { id: "invalid-parameters-format", data: { id: "step-up-required" } } })))
      .toEqual(["invalid-parameters-format", "step-up-required"]);
  });

  it("[APIR2] anything else reads as no id", () => {
    for (const body of ["", "not json", "null", "[]", JSON.stringify({ ok: true }), JSON.stringify({ error: { id: 42 } })]) {
      expect(apiErrorIds(body)).toEqual([]);
    }
  });
});

describe("[APIL] errors as they are logged", () => {
  it("[APIL1] URLs and token@host parts never reach the log line", () => {
    expect(redactUrls("GET https://tok3n@alice.core.test/accesses failed")).toBe("GET <url> failed");
    expect(redactUrls("capability cap-secret@requester.test/ gone")).toBe("capability <redacted> gone");
    expect(redactUrls("plain text stays")).toBe("plain text stays");
    expect(redactUrls("x".repeat(400))).toHaveLength(300);
  });

  it("[APIL2] a line of the platform id and message, never the object", () => {
    const apiError = Object.assign(new Error("Request failed: {\"apiEndpoint\":\"https://tok3n@alice.core.test/\"}"), {
      innerObject: { id: "forbidden", message: "Access to https://tok3n@alice.core.test/ denied" },
    });
    expect(loggableError(apiError)).toBe("forbidden: Access to <url> denied");
    expect(loggableError(Object.assign(new Error("Failed to fetch"), { id: "cmc-capability-invalid" }))).toBe(
      "cmc-capability-invalid: Failed to fetch",
    );
    expect(loggableError(new TypeError("Failed to fetch https://cap@r.test/"))).toBe("Failed to fetch <url>");
    expect(loggableError("network down")).toBe("network down");
    expect(loggableError({ url: "https://tok3n@alice.core.test/" })).toBe("unknown error");
    expect(loggableError(null)).toBe("unknown error");
  });

  it("[APIL3] a hostile, unbounded message is handled in linear time and still redacted", () => {
    const hostile = [
      "a".repeat(200_000),
      "a.".repeat(100_000),
      "a+".repeat(100_000),
      "a".repeat(100_000) + "@",
      "a:".repeat(100_000),
    ];
    for (const text of hostile) {
      const start = performance.now();
      redactUrls(text);
      expect(performance.now() - start, text.slice(0, 4)).toBeLessThan(50);
    }
    expect(redactUrls("CMC accept failed: https://tok@alice.core.test/ " + "x".repeat(200_000))).toMatch(/^CMC accept failed: <url> x+$/);
  });

  it("[APIL4] a dotless host, an over-long scheme or userinfo: still redacted, from the bounded part on", () => {
    expect(redactUrls("tok@localhost/x failed")).toBe("<redacted> failed");
    expect(redactUrls("at tok@localhost")).toBe("at <redacted>");
    // A scheme is at most 32 characters: a longer run keeps its head, the URL is still replaced.
    expect(redactUrls("s".repeat(40) + "://tok@host/")).toBe("s".repeat(8) + "<url>");
    // Userinfo is at most 512 characters before the "@".
    expect(redactUrls("u".repeat(600) + "@host")).toBe("u".repeat(88) + "<redacted>");
  });
});
