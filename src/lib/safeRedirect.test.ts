import { describe, it, expect } from "vitest";
import { assertHttpUrl, httpUrlOrNull, trustedOpenerOrigin } from "./safeRedirect";

describe("assertHttpUrl", () => {
  it("accepts absolute https and http URLs", () => {
    expect(assertHttpUrl("https://app.example/cb?code=1").protocol).toBe("https:");
    expect(assertHttpUrl("http://127.0.0.1:3000/back").protocol).toBe("http:");
  });

  it("rejects a javascript: target", () => {
    expect(() => assertHttpUrl("javascript:alert(1)")).toThrow(/http\(s\)/);
  });

  it("rejects a data: target", () => {
    expect(() => assertHttpUrl("data:text/html,<script>alert(1)</script>")).toThrow(/http\(s\)/);
  });

  it("rejects other schemes (file:)", () => {
    expect(() => assertHttpUrl("file:///etc/passwd")).toThrow(/http\(s\)/);
  });

  it("rejects a relative path (no scheme)", () => {
    expect(() => assertHttpUrl("/callback?code=1")).toThrow(/invalid redirect target/);
    expect(() => assertHttpUrl("not a url")).toThrow(/invalid redirect target/);
  });
});

describe("httpUrlOrNull", () => {
  it("returns the parsed URL for http(s) targets", () => {
    expect(httpUrlOrNull("https://app.example/cb")?.origin).toBe("https://app.example");
  });

  it("returns null for unsafe or empty inputs", () => {
    expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(httpUrlOrNull("/relative")).toBeNull();
    expect(httpUrlOrNull(null)).toBeNull();
    expect(httpUrlOrNull(undefined)).toBeNull();
    expect(httpUrlOrNull("")).toBeNull();
  });
});

describe("trustedOpenerOrigin", () => {
  it("prefers the REAL opener (referrer) origin over the caller-supplied returnUrl", () => {
    // returnUrl is caller-controlled, so it must NOT win the pin: the referrer
    // (the page that actually opened the popup) is the legitimate target.
    expect(trustedOpenerOrigin("https://attacker.example/back", "https://opener.example/from")).toBe(
      "https://opener.example",
    );
  });

  it("falls back to the returnUrl origin only when the referrer is absent or unsafe", () => {
    expect(trustedOpenerOrigin("https://app.example/back", null)).toBe("https://app.example");
    expect(trustedOpenerOrigin("https://app.example/back", "")).toBe("https://app.example");
    expect(trustedOpenerOrigin("https://app.example/back", "javascript:alert(1)")).toBe(
      "https://app.example",
    );
  });

  it("returns null when neither yields a safe origin", () => {
    expect(trustedOpenerOrigin(null, "")).toBeNull();
    expect(trustedOpenerOrigin("data:text/html,x", "not a url")).toBeNull();
  });
});
