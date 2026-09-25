import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Moon, Sun } from "lucide-react";
import { getThemeSettings } from "../lib/deployedSettings";
import {
  applyTheme,
  readStoredChoice,
  resolveChoice,
  storeChoice,
  THEME_CHOICES,
  type ThemeChoice,
} from "../lib/theme";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Header control for the user's theme: follow the system, light, or dark.
 * Three toggle buttons in a labelled group; the current one is `aria-pressed`.
 * Renders nothing when the operator disabled the user choice in settings.json.
 */
export default function ThemeToggle() {
  const { t } = useTranslation();
  const settings = getThemeSettings();
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    resolveChoice(readStoredChoice(), settings.default, settings.userChoice),
  );
  if (!settings.userChoice) return null;

  const pick = (next: ThemeChoice) => {
    setChoice(next);
    storeChoice(next);
    applyTheme(next);
  };

  return (
    <div
      role="group"
      aria-label={t("theme.label")}
      className="flex items-center overflow-hidden rounded border border-divider"
    >
      {THEME_CHOICES.map((c) => {
        const Icon = ICONS[c];
        const active = c === choice;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            aria-label={t(`theme.${c}`)}
            title={t(`theme.${c}`)}
            onClick={() => pick(c)}
            className={`p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active ? "bg-primary/15 text-primary" : "text-muted hover:text-ink"
            }`}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
