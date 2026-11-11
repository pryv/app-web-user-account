import { describe, it, expect } from "vitest";
import { trustedOriginEntry, originTrusted } from "./originMatch";

/**
 * [ORGM] Trusted API origin entries: exact origins and one-label wildcards
 * (`https://*.example.com`), for platforms with per-user hosts.
 */

describe("[ORGM] trustedOriginEntry", () => {
  it("[ORG1] keeps exact origins, normalised", () => {
    expect(trustedOriginEntry(" https://Core.Example.com/some/path ")).toBe("https://core.example.com");
    expect(trustedOriginEntry("https://core.example.com:443")).toBe("https://core.example.com");
    expect(trustedOriginEntry("https://core.example.com:8443/")).toBe("https://core.example.com:8443");
    expect(trustedOriginEntry("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("[ORG2] keeps a one-label wildcard, normalised", () => {
    expect(trustedOriginEntry("https://*.example.com")).toBe("https://*.example.com");
    expect(trustedOriginEntry(" HTTPS://*.Example.COM/ ")).toBe("https://*.example.com");
    expect(trustedOriginEntry("https://*.example.com:443")).toBe("https://*.example.com");
    expect(trustedOriginEntry("https://*.example.com:8443")).toBe("https://*.example.com:8443");
    expect(trustedOriginEntry("https://*.bücher.example")).toBe("https://*.xn--bcher-kva.example");
  });

  it("[ORG3] drops wildcards it cannot keep narrow", () => {
    for (const bad of [
      "https://*.com", // a top-level domain
      "https://*", "https://*.", "https://*..example.com",
      "http://*.example.com", // https only
      "*.example.com", // no scheme
      "https://*.*.example.com", "https://a.*.example.com", "https://*a.example.com", "https://a*.example.com",
      "https://*.example.com/path", "https://*.example.com?x=1", "https://*.example.com#f",
      "https://*.evil.example@core.example.com", // userinfo trick
      "https://*.127.0.0.1", "https://*.[::1]",
    ]) {
      expect(trustedOriginEntry(bad), bad).toBeNull();
    }
  });

  it("[ORG4] drops what is no http(s) origin at all", () => {
    for (const bad of ["", "not a url", "javascript:alert(1)", "ftp://core.example.com", "/relative"]) {
      expect(trustedOriginEntry(bad), bad).toBeNull();
    }
  });
});

describe("[ORGM] originTrusted", () => {
  const entries = ["https://core.example.net", "https://*.example.com", "https://*.ports.example:8443"];

  it("[ORG5] an exact entry matches that origin only", () => {
    expect(originTrusted("https://core.example.net", entries)).toBe(true);
    expect(originTrusted("https://core.example.net/some/path?x=1", entries)).toBe(true);
    expect(originTrusted("https://core.example.net:8443", entries)).toBe(false);
    expect(originTrusted("https://other.example.net", entries)).toBe(false);
  });

  it("[ORG6] a wildcard matches exactly one label below its domain", () => {
    expect(originTrusted("https://alice.example.com", entries)).toBe(true);
    expect(originTrusted("https://a-1b2c3d4e.example.com/", entries)).toBe(true);
    expect(originTrusted("https://example.com", entries)).toBe(false); // the apex
    expect(originTrusted("https://a.b.example.com", entries)).toBe(false); // two labels down
    expect(originTrusted("https://alice.example.com.evil.net", entries)).toBe(false);
    expect(originTrusted("https://aliceexample.com", entries)).toBe(false);
  });

  it("[ORG7] a wildcard matches its scheme and port only", () => {
    expect(originTrusted("http://alice.example.com", entries)).toBe(false);
    expect(originTrusted("https://alice.example.com:8443", entries)).toBe(false);
    expect(originTrusted("https://alice.ports.example:8443", entries)).toBe(true);
    expect(originTrusted("https://alice.ports.example", entries)).toBe(false);
  });

  it("[ORG9] the origin is compared as the URL parser normalises it", () => {
    const cases: [string, boolean][] = [
      ["https://alice.example.com.", false], // a trailing dot is another host
      ["https://alice.example.com:443", true], // the default port is dropped
      ["https://alice.example.com:0443", true],
      ["https://ALICE.Example.COM", true], // hosts are lower-cased
      ["https://bücher.example.com", true], // IDN, compared in its punycode form
      ["https://büсher.example.com", true], // a Cyrillic look-alike is another single label: still one label down
      ["https://user:pw@alice.example.com", true], // userinfo is not part of the origin the page talks to
      ["https://alice.example.com\\@evil.net", true], // the parser reads the backslash as a path: the host is alice.example.com
      ["https://evil.net\\@alice.example.com", false],
    ];
    for (const [origin, expected] of cases) expect(originTrusted(origin, ["https://*.example.com"]), origin).toBe(expected);
    expect(trustedOriginEntry("https://*.example.com:00")).toBeNull();
  });

  it("[ORG10] no public-suffix list: a wildcard on one is kept, as documented (operators list a domain they control)", () => {
    expect(trustedOriginEntry("https://*.co.uk")).toBe("https://*.co.uk");
  });

  it("[ORG8] nothing matches an empty list or a non-URL", () => {
    expect(originTrusted("https://alice.example.com", [])).toBe(false);
    expect(originTrusted("not a url", entries)).toBe(false);
  });
});
