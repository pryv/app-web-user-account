import { describe, it, expect, vi, afterEach } from "vitest";
import { trustedApiOrigins, parseOriginList } from "./trustedOrigins";
import { _setDeployedSettingsForTest } from "./deployedSettings";

/**
 * [TORG] The trusted core origins: the build-time list and the settings.json
 * list, unioned, exact origins only.
 */

const ENV = "VITE_OAUTH_TRUSTED_API_ORIGINS";

afterEach(() => {
  vi.unstubAllEnvs();
  _setDeployedSettingsForTest(null);
});

describe("[TORG] trustedApiOrigins", () => {
  it("[TOR1] unions the build-time list and the settings.json list", () => {
    vi.stubEnv(ENV, "https://core.example.com");
    _setDeployedSettingsForTest({ trustedApiOrigins: ["https://core2.example.net"] });
    expect(trustedApiOrigins()).toEqual(["https://core.example.com", "https://core2.example.net"]);
  });

  it("[TOR2] de-duplicates an origin present in both lists", () => {
    vi.stubEnv(ENV, "https://core.example.com,https://core.example.com/");
    _setDeployedSettingsForTest({ trustedApiOrigins: ["https://core.example.com"] });
    expect(trustedApiOrigins()).toEqual(["https://core.example.com"]);
  });

  it("[TOR3] trims build-time entries and normalises them to exact origins", () => {
    vi.stubEnv(ENV, "  https://core.example.com/some/path ,\thttps://core.example.com:8443/  ");
    _setDeployedSettingsForTest(null);
    expect(trustedApiOrigins()).toEqual(["https://core.example.com", "https://core.example.com:8443"]);
  });

  it("[TOR4] drops invalid build-time entries", () => {
    vi.stubEnv(ENV, "not a url,,javascript:alert(1),ftp://core.example.com,*.example.com,https://ok.example.com");
    expect(trustedApiOrigins()).toEqual(["https://ok.example.com"]);
  });

  it("[TOR5] is empty when neither source names an origin", () => {
    vi.stubEnv(ENV, "");
    expect(trustedApiOrigins()).toEqual([]);
    vi.stubEnv(ENV, " , ");
    expect(trustedApiOrigins()).toEqual([]);
  });

  it("[TOR6] the settings.json list alone is enough", () => {
    vi.stubEnv(ENV, "");
    _setDeployedSettingsForTest({ trustedApiOrigins: ["https://core.example.org"] });
    expect(trustedApiOrigins()).toEqual(["https://core.example.org"]);
  });

  it("[TOR7] parseOriginList tolerates an unset value", () => {
    expect(parseOriginList(undefined)).toEqual([]);
    expect(parseOriginList(null)).toEqual([]);
  });
});
