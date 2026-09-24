import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * [SVDF] Which platform `getService` talks to: the query param, else the
 * deployment's settings.json, else a clear configuration error.
 */

vi.mock("pryv", () => ({
  default: {
    Service: class {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    MfaRequiredError: class extends Error {},
  },
}));

import { getService } from "./service";
import { _setDeployedSettingsForTest } from "./deployedSettings";

const DEPLOY_URL = "https://reg.deploy.test/service/info";
const PARAM_URL = "https://reg.param.test/service/info";

afterEach(() => _setDeployedSettingsForTest(null));

describe("[SVDF] getService platform resolution", () => {
  it("[SVD1] the query param wins over settings.json", () => {
    _setDeployedSettingsForTest({ serviceInfoUrl: DEPLOY_URL });
    const service = getService("?pryvServiceInfoUrl=" + encodeURIComponent(PARAM_URL)) as unknown as { url: string };
    expect(service.url).toBe(PARAM_URL);
  });

  it("[SVD2] settings.json names the platform when there is no param", () => {
    _setDeployedSettingsForTest({ serviceInfoUrl: DEPLOY_URL });
    const service = getService("") as unknown as { url: string };
    expect(service.url).toBe(DEPLOY_URL);
  });

  it("[SVD3] with neither, the error points the operator at settings.json", () => {
    expect(() => getService("")).toThrow(/settings\.json/);
  });

  it("[SVD4] a restricted deployment refuses a link naming another platform", () => {
    _setDeployedSettingsForTest({ serviceInfoUrl: DEPLOY_URL, allowedServiceInfoUrls: [DEPLOY_URL] });
    expect(() => getService("?pryvServiceInfoUrl=" + encodeURIComponent(PARAM_URL))).toThrow(
      /does not serve the platform/,
    );
    const own = getService("?pryvServiceInfoUrl=" + encodeURIComponent(DEPLOY_URL)) as unknown as { url: string };
    expect(own.url).toBe(DEPLOY_URL);
  });
});
