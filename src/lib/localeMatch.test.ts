import { describe, it, expect } from "vitest";

/** [LCMT] The language a per-language map is read in. */

import { isNonEmptyString, isString, localeCandidates, pickLocalized } from "./localeMatch";

describe("[LCMT] localeMatch", () => {
  it("[LCM1] full tag, base, other regions of the base, then English", () => {
    const keys = ["de", "en-GB", "pt-PT", "en", "pt", "pt-BR", "fr"];
    expect(localeCandidates(keys, "pt-BR")).toEqual(["pt-BR", "pt", "pt-PT", "en", "en-GB"]);
    expect(localeCandidates(keys, "pt")).toEqual(["pt", "pt-PT", "pt-BR", "en", "en-GB"]);
    expect(localeCandidates(keys, "it-CH")).toEqual(["en", "en-GB"]);
    expect(localeCandidates(keys, "en-US")).toEqual(["en", "en-GB"]);
    expect(localeCandidates(["de"], "fr")).toEqual([]);
  });

  it("[LCM2] tags compare case-insensitively, `_` read as `-`", () => {
    expect(localeCandidates(["PT_br", "en"], "pt-BR")).toEqual(["PT_br", "en"]);
    expect(localeCandidates(["pt-BR"], "PT")).toEqual(["pt-BR"]);
    expect(localeCandidates(["en"], "")).toEqual(["en"]);
  });

  it("[LCM3] pickLocalized skips values the caller does not accept", () => {
    expect(pickLocalized({ "pt-BR": "", pt: "Olá", en: "Hello" }, "pt-BR", isNonEmptyString)).toBe("Olá");
    expect(pickLocalized({ "pt-BR": "", en: "Hello" }, "pt-BR", isString)).toBe("");
    expect(pickLocalized({ "pt-BR": 3, en: "Hello" }, "pt-BR", isString)).toBe("Hello");
    expect(pickLocalized({ de: "Hallo" }, "pt-BR", isString)).toBeUndefined();
  });
});
