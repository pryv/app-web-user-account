import { describe, it, expect, vi, afterEach } from "vitest";
import { returnDecision } from "./returnTarget";
import { _setDeployedSettingsForTest, parseDeployedSettings } from "./deployedSettings";

/**
 * [RETP] The operator's return policy for caller-supplied return addresses:
 * no policy follows every http(s) address (the behaviour before the policy
 * existed); with one, this app's origin and the listed origins are followed
 * and any other origin gets the configured action.
 */

const SELF = "https://account.example.com";

afterEach(() => {
  _setDeployedSettingsForTest(null);
});

describe("[RETP] returnDecision", () => {
  it("[RET1] without a policy, any http(s) address is followed", () => {
    expect(returnDecision("https://example.org/x", SELF)).toMatchObject({ action: "follow" });
    expect(returnDecision("http://app.example.net/", SELF)).toMatchObject({ action: "follow" });
  });

  it("[RET2] a non-http(s) address is never followed", () => {
    expect(returnDecision("javascript:alert(1)", SELF)).toBeNull();
    expect(returnDecision("/relative", SELF)).toBeNull();
    expect(returnDecision(null, SELF)).toBeNull();
  });

  it("[RET3] with a policy, listed origins and this app's origin are followed, others get otherOrigins", () => {
    for (const otherOrigins of ["confirm", "stay", "follow"] as const) {
      _setDeployedSettingsForTest({ returnPolicy: { trustedOrigins: ["https://app.example.org"], otherOrigins } });
      expect(returnDecision("https://app.example.org/done?a=b", SELF)?.action).toBe("follow");
      expect(returnDecision(`${SELF}/account/profile`, SELF)?.action).toBe("follow");
      expect(returnDecision("https://example.net/", SELF)?.action).toBe(otherOrigins);
    }
  });

  it("[RET4] listed origins match exactly (scheme, host and port)", () => {
    _setDeployedSettingsForTest({ returnPolicy: { trustedOrigins: ["https://app.example.org"], otherOrigins: "stay" } });
    for (const raw of ["http://app.example.org/", "https://app.example.org:8443/", "https://sub.app.example.org/"]) {
      expect(returnDecision(raw, SELF)?.action, raw).toBe("stay");
    }
  });

  it("[RET5] settings.json: trusted entries are https (http on loopback only), exact origins", () => {
    _setDeployedSettingsForTest(parseDeployedSettings({
      returnPolicy: { trustedOrigins: ["https://app.example.org/x", "http://plain.example.org", "http://localhost:5173", 3], otherOrigins: "stay" },
    }));
    expect(returnDecision("https://app.example.org/y", SELF)?.action).toBe("follow");
    expect(returnDecision("http://localhost:5173/", SELF)?.action).toBe("follow");
    expect(returnDecision("http://plain.example.org/", SELF)?.action).toBe("stay");
  });

  it("[RET6] settings.json: an invalid otherOrigins is ignored (follow) and said; a list without it follows other origins", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    _setDeployedSettingsForTest(parseDeployedSettings({ returnPolicy: { otherOrigins: "Stay" } }));
    expect(returnDecision("https://example.net/", SELF)?.action).toBe("follow");
    expect(warn.mock.calls.flat().join(" ")).toContain("returnPolicy.otherOrigins");
    warn.mockRestore();
    _setDeployedSettingsForTest(parseDeployedSettings({ returnPolicy: { trustedOrigins: ["https://app.example.org"] } }));
    expect(returnDecision("https://example.net/", SELF)?.action).toBe("follow");
    _setDeployedSettingsForTest(parseDeployedSettings({ returnPolicy: { otherOrigins: "confirm" } }));
    expect(returnDecision("https://example.net/", SELF)?.action).toBe("confirm");
  });
});
