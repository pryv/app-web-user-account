import { describe, it, expect } from "vitest";
import { isSessionRejected } from "./sessionErrors";
import { CheckAppError } from "./accessFlow";

describe("[SRJ] isSessionRejected", () => {
  it("[SRJ1] rejected: HTTP 401/403 and the invalid-token / forbidden ids", () => {
    expect(isSessionRejected(new CheckAppError(401))).toBe(true);
    expect(isSessionRejected(new CheckAppError(403))).toBe(true);
    expect(isSessionRejected(new CheckAppError(400, "invalid-access-token"))).toBe(true);
    expect(isSessionRejected({ innerObject: { id: "invalid-access-token" } })).toBe(true);
    expect(isSessionRejected({ response: { status: 200, body: { error: { id: "forbidden" } } } })).toBe(true);
    expect(isSessionRejected({ response: { status: 401 } })).toBe(true);
  });

  it("[SRJ2] not rejected: network errors, 5xx, other ids, non-objects", () => {
    expect(isSessionRejected(new TypeError("Failed to fetch"))).toBe(false);
    expect(isSessionRejected(new CheckAppError(500))).toBe(false);
    expect(isSessionRejected(new CheckAppError(503, "api-unavailable"))).toBe(false);
    expect(isSessionRejected({ innerObject: { id: "unexpected-error" } })).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
    expect(isSessionRejected("invalid-access-token")).toBe(false);
  });
});
