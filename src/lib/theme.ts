/**
 * Light / dark theme.
 *
 * The operator picks the default in settings.json (`theme.default`: `light`,
 * `dark` or `system`, which follows the OS) and whether users may override it
 * (`theme.userChoice`). A user's pick is kept in localStorage under
 * `pryv.theme`. The resolved choice is written to `<html data-theme>`, which
 * index.css reads: `light` and `dark` pin the palette, no attribute follows
 * `prefers-color-scheme`.
 */

export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";

export interface ThemeSettings {
  /** The operator's default. */
  default: ThemeChoice;
  /** Whether the header shows the toggle and a stored pick is honoured. */
  userChoice: boolean;
}

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Shared-origin safe: other apps on the same origin see the same storage. */
export const THEME_STORAGE_KEY = "pryv.theme";

export function isThemeChoice(raw: unknown): raw is ThemeChoice {
  return raw === "light" || raw === "dark" || raw === "system";
}

/** The user's stored pick, or null (none, invalid, or storage unavailable). */
export function readStoredChoice(): ThemeChoice | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Store the user's pick; null clears it. Silently a no-op without storage. */
export function storeChoice(choice: ThemeChoice | null): void {
  try {
    if (choice === null) localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked or full: the pick holds for this page only.
  }
}

/** The choice to apply: the stored pick when the operator allows one, else the operator default. */
export function resolveChoice(
  stored: ThemeChoice | null,
  operatorDefault: ThemeChoice,
  userChoiceAllowed: boolean,
): ThemeChoice {
  return userChoiceAllowed && stored ? stored : operatorDefault;
}

/**
 * Write the choice onto `<html>` as `data-theme` (removed for `system`). The
 * stylesheet derives the palette and `color-scheme` from the attribute, so a
 * rebranding stylesheet can still override both.
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}
