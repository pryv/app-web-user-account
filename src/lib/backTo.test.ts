import { describe, it, expect, vi, afterEach } from "vitest";
import { inPopupOrFrame, parseBackTo } from "./backTo";

describe("[BTP] inPopupOrFrame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[BTP1] a plain tab: false", () => {
    const win: Record<string, unknown> = { opener: null };
    win.top = win;
    win.self = win;
    vi.stubGlobal("window", win);
    expect(inPopupOrFrame()).toBe(false);
  });

  it("[BTP2] a pop-up an app opened (opener set): true", () => {
    const win: Record<string, unknown> = { opener: {} };
    win.top = win;
    win.self = win;
    vi.stubGlobal("window", win);
    expect(inPopupOrFrame()).toBe(true);
  });

  it("[BTP3] a page in a frame: true", () => {
    const win: Record<string, unknown> = { opener: null, top: {} };
    win.self = win;
    vi.stubGlobal("window", win);
    expect(inPopupOrFrame()).toBe(true);
  });
});

describe("parseBackTo", () => {
  it("accepts external https URLs and exposes the host for display", () => {
    const b = parseBackTo(
      "?backUrl=" + encodeURIComponent("https://demo.example.com/app?x=1") + "&backLabel=Demo",
    );
    expect(b.url).toBe("https://demo.example.com/app?x=1");
    expect(b.host).toBe("demo.example.com");
    expect(b.label).toBe("Demo");
  });

  it("rejects non-http(s) schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
      const b = parseBackTo("?backUrl=" + encodeURIComponent(bad));
      expect(b.url).toBeNull();
      expect(b.host).toBeNull();
    }
  });

  it("returns nulls when params are absent", () => {
    expect(parseBackTo("")).toEqual({ url: null, label: null, host: null });
  });
});
