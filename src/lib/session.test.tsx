// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

/**
 * The session stack behind "Back to <parent>": acting on a controlled account
 * keeps the signed-in account's session, going back restores it, and signing
 * out (or signing in anew) ends both.
 */

vi.mock("pryv", () => ({
  default: {
    Service: class {},
    Connection: class {
      apiEndpoint: string;
      endpoint: string;
      constructor(apiEndpoint: string) {
        this.apiEndpoint = apiEndpoint;
        this.endpoint = apiEndpoint;
      }
    },
  },
}));

import { SessionProvider, useSession, storedServiceInfoUrl, type PryvConnection } from "./session";
import { _setDeployedSettingsForTest } from "./deployedSettings";

const conn = (apiEndpoint: string) => ({ apiEndpoint, endpoint: apiEndpoint }) as unknown as PryvConnection;
let session: ReturnType<typeof useSession>;
function Probe() {
  session = useSession();
  return null;
}
const mount = () => render(<SessionProvider><Probe /></SessionProvider>);

describe("[SST] session stack", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it("[SST1] acting as a controlled account keeps the parent session; going back restores it", () => {
    mount();
    act(() => session.setConnection(conn("https://parent-tok@core.test/parent/"), "https://core.test/service/info"));
    act(() => session.actAs(conn("https://pat@core.test/kid/"), { username: "kid", parentUsername: "parent" }));
    expect(session.connection?.apiEndpoint).toBe("https://pat@core.test/kid/");
    expect(session.actingAs).toEqual({ username: "kid", parentUsername: "parent" });

    // survives a reload
    cleanup();
    mount();
    expect(session.actingAs).toEqual({ username: "kid", parentUsername: "parent" });
    expect(session.connection?.apiEndpoint).toBe("https://pat@core.test/kid/");

    act(() => session.backToParent());
    expect(session.connection?.apiEndpoint).toBe("https://parent-tok@core.test/parent/");
    expect(session.actingAs).toBeNull();
    expect(localStorage.getItem("pryv.session.parent.apiEndpoint")).toBeNull();
  });

  it("[SST2] a nested hand-off still returns to the first account", () => {
    mount();
    act(() => session.setConnection(conn("https://parent-tok@core.test/parent/"), "https://core.test/service/info"));
    act(() => session.actAs(conn("https://pat1@core.test/kid/"), { username: "kid", parentUsername: "parent" }));
    act(() => session.actAs(conn("https://pat2@core.test/grandkid/"), { username: "grandkid", parentUsername: "kid" }));
    expect(session.actingAs).toEqual({ username: "grandkid", parentUsername: "parent" });
    act(() => session.backToParent());
    expect(session.connection?.apiEndpoint).toBe("https://parent-tok@core.test/parent/");
  });

  it("[SST3] signing out, or signing in anew, ends the hand-off and forgets the parent", () => {
    for (const next of [null, conn("https://other-tok@core.test/other/")]) {
      localStorage.clear();
      mount();
      act(() => session.setConnection(conn("https://parent-tok@core.test/parent/"), "https://core.test/service/info"));
      act(() => session.actAs(conn("https://pat@core.test/kid/"), { username: "kid", parentUsername: "parent" }));
      act(() => session.setConnection(next, "https://core.test/service/info"));
      expect(session.actingAs).toBeNull();
      expect(localStorage.getItem("pryv.session.parent.apiEndpoint")).toBeNull();
      expect(localStorage.getItem("pryv.session.actingAs")).toBeNull();
      expect(JSON.stringify({ ...localStorage })).not.toContain("parent-tok");
      cleanup();
    }
  });
});

describe("[SSDF] session platform from settings.json", () => {
  const DEPLOY_URL = "https://reg.deploy.test/service/info";
  beforeEach(() => {
    localStorage.clear();
    _setDeployedSettingsForTest({ serviceInfoUrl: DEPLOY_URL });
  });
  afterEach(() => {
    cleanup();
    _setDeployedSettingsForTest(null);
  });

  it("[SSD1] a session opened without the param survives a remount", () => {
    mount();
    act(() => session.setConnection(conn("https://tok@core.test/alice/"), null));
    expect(localStorage.getItem("pryv.session.serviceInfoUrl")).toBe(DEPLOY_URL);
    cleanup();
    mount();
    expect(session.connection?.apiEndpoint).toBe("https://tok@core.test/alice/");
  });

  it("[SSD2] an endpoint stored without a platform restores on the deployment default", () => {
    localStorage.setItem("pryv.session.apiEndpoint", "https://tok@core.test/alice/");
    mount();
    expect(session.connection?.apiEndpoint).toBe("https://tok@core.test/alice/");
    // The platform checks agree with what was restored.
    expect(storedServiceInfoUrl()).toBe(DEPLOY_URL);
    localStorage.clear();
    expect(storedServiceInfoUrl()).toBeNull();
  });

  it("[SSD3] an explicit platform is persisted as given", () => {
    mount();
    act(() => session.setConnection(conn("https://tok@core.test/alice/"), "https://reg.other.test/service/info"));
    expect(localStorage.getItem("pryv.session.serviceInfoUrl")).toBe("https://reg.other.test/service/info");
  });
});
