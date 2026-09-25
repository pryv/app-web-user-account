// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyTheme,
  readStoredChoice,
  resolveChoice,
  storeChoice,
  THEME_STORAGE_KEY,
  type ThemeChoice,
} from "./theme";

/** [THMT] Theme choice: storage, resolution against the operator's ruling, and the `<html>` attribute. */

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  applyTheme("system");
});

describe("[THMT] theme", () => {
  it("[THT1] stores, reads back and clears the pick under pryv.theme", () => {
    expect(readStoredChoice()).toBeNull();
    storeChoice("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredChoice()).toBe("dark");
    storeChoice(null);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredChoice()).toBeNull();
  });

  it("[THT2] the stored pick wins only when the operator allows a user choice", () => {
    const choices: (ThemeChoice | null)[] = [null, "system", "light", "dark"];
    for (const operatorDefault of ["system", "light", "dark"] as const) {
      for (const stored of choices) {
        expect(resolveChoice(stored, operatorDefault, false)).toBe(operatorDefault);
        expect(resolveChoice(stored, operatorDefault, true)).toBe(stored ?? operatorDefault);
      }
    }
  });

  it("[THT3] a throwing localStorage leaves the operator default and never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => storeChoice("dark")).not.toThrow();
    expect(() => storeChoice(null)).not.toThrow();
    expect(readStoredChoice()).toBeNull();
    expect(resolveChoice(readStoredChoice(), "light", true)).toBe("light");
  });

  it("[THT4] applyTheme sets data-theme and color-scheme, and system removes both", () => {
    const root = document.documentElement;
    applyTheme("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
    applyTheme("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
    applyTheme("system");
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.getPropertyValue("color-scheme")).toBe("");
  });
});
