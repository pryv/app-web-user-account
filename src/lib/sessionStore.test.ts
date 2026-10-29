// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { storedSessionTokens, STORE_KEY_API, STORE_KEY_PARENT_API } from "./sessionStore";

describe("[SSTK] storedSessionTokens", () => {
  afterEach(() => localStorage.clear());

  it("[SST1] reads the token of the signed-in session and of the parent one", () => {
    localStorage.setItem(STORE_KEY_API, "https://tok-a@core.test/alice/");
    localStorage.setItem(STORE_KEY_PARENT_API, "https://tok-b@core.test/bob/");
    expect(storedSessionTokens()).toEqual(["tok-a", "tok-b"]);
  });

  it("[SST2] nothing stored, or an entry without a token, gives none", () => {
    expect(storedSessionTokens()).toEqual([]);
    localStorage.setItem(STORE_KEY_API, "https://core.test/alice/");
    localStorage.setItem(STORE_KEY_PARENT_API, "not a url");
    expect(storedSessionTokens()).toEqual([]);
  });
});
