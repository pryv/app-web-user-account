import { describe, it, expect } from "vitest";
import { loggableError, redactUrls } from "./apiError";

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
});
