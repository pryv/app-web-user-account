import { describe, it, expect } from "vitest";

/** [LGAL] Terms / Privacy links from the deployment settings. */

import { resolveLocalizedUrl, parseLegalSettings, safeLegalUrl } from "./legal";

describe("[LGAL] legal links", () => {
  it("[LGA1] picks the exact language, then its base, then en, then the first", () => {
    const map = { en: "https://x.example/en", fr: "https://x.example/fr", "pt-BR": "https://x.example/br" };
    expect(resolveLocalizedUrl(map, "pt-BR")).toBe("https://x.example/br");
    expect(resolveLocalizedUrl(map, "fr-CH")).toBe("https://x.example/fr");
    expect(resolveLocalizedUrl(map, "de")).toBe("https://x.example/en");
    expect(resolveLocalizedUrl({ it: "https://x.example/it" }, "de")).toBe("https://x.example/it");
    expect(resolveLocalizedUrl("https://x.example/one", "de")).toBe("https://x.example/one");
    expect(resolveLocalizedUrl(undefined, "en")).toBeNull();
  });

  it("[LGA2] never returns a non-http(s) URL", () => {
    expect(resolveLocalizedUrl("javascript:alert(1)", "en")).toBeNull();
    expect(resolveLocalizedUrl({ en: "data:text/html,x" }, "en")).toBeNull();
    expect(safeLegalUrl("http://x.example/t")).toBe("http://x.example/t");
  });

  it("[LGA3] parseLegalSettings keeps only safe entries, and null when none", () => {
    expect(parseLegalSettings({ terms: "https://t.example" })).toEqual({ terms: "https://t.example" });
    expect(parseLegalSettings({ terms: "javascript:x", privacy: {} })).toBeNull();
    expect(parseLegalSettings("nope")).toBeNull();
  });
});
