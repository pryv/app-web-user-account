// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ThemeToggle from "./ThemeToggle";
import { _setDeployedSettingsForTest, parseDeployedSettings } from "../lib/deployedSettings";
import { applyTheme, THEME_STORAGE_KEY } from "../lib/theme";

/** [THMG] The header theme toggle: three states, persisted, hidden when the operator forbids a choice. */

afterEach(() => {
  cleanup();
  _setDeployedSettingsForTest(null);
  localStorage.clear();
  applyTheme("system");
});

const pressed = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("aria-label"));

describe("[THMG] theme toggle", () => {
  it("[TGL1] a labelled group of three buttons, the operator default pressed", () => {
    _setDeployedSettingsForTest(parseDeployedSettings({ theme: { default: "dark" } }));
    render(<ThemeToggle />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(pressed()).toEqual(["Dark theme"]);
  });

  it("[TGL2] cycles through the states, writing the attribute and the stored pick", () => {
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Use system theme"]);
    const root = document.documentElement;

    fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(root.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(pressed()).toEqual(["Dark theme"]);

    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "Use system theme" }));
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(pressed()).toEqual(["Use system theme"]);
  });

  it("[TGL3] starts from the stored pick when a user choice is allowed", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    _setDeployedSettingsForTest(parseDeployedSettings({ theme: { default: "dark" } }));
    render(<ThemeToggle />);
    expect(pressed()).toEqual(["Light theme"]);
  });

  it("[TGL4] renders nothing when the operator sets userChoice to false", () => {
    _setDeployedSettingsForTest(parseDeployedSettings({ theme: { default: "dark", userChoice: false } }));
    const { container } = render(<ThemeToggle />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });
});
