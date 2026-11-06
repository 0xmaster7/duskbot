import { useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { SKINS, THEME_SKINS, applySkinChoice, readSkinChoice, subscribeSkin, type SkinChoice } from "@/lib/skins";
import { SettingRow } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";

const THEMES = [
  { choice: "system", label: "settings.simple.theme.system" },
  { choice: THEME_SKINS.light, label: "settings.theme.light" },
  { choice: THEME_SKINS.dark, label: "settings.theme.dark" },
] as const satisfies readonly { choice: SkinChoice; label: string }[];

/** the other looks, after Grok's three themes in the same select */
const LOOKS = SKINS.filter((skin) => !THEMES.some((theme) => theme.choice === skin.id));

export function useSkinChoice(): SkinChoice {
  return useSyncExternalStore(subscribeSkin, readSkinChoice, readSkinChoice);
}

/** Grok's three themes, then the other looks. */
export const themeOptions = () => [
  ...THEMES.map((theme) => ({ value: theme.choice, label: t(theme.label) })),
  ...LOOKS.map((skin) => ({ value: skin.id, label: skin.name })),
];

export function ThemeRow() {
  const choice = useSkinChoice();
  return (
    <SettingRow title={t("settings.theme.title")}>
      <SettingsSelect
        data-settings-select="theme"
        value={choice}
        aria-label={t("settings.theme.title")}
        options={themeOptions()}
        onChange={(event) => {
          const next = [...THEMES.map((theme) => theme.choice), ...LOOKS.map((skin) => skin.id)].find((value) => value === event.target.value);
          if (next) applySkinChoice(next);
        }}
      />
    </SettingRow>
  );
}
