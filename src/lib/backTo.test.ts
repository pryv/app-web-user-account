import { describe, it, expect } from "vitest";
import { parseBackTo } from "./backTo";

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
