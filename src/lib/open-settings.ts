// where each setting lives and the action that opens Settings there: kept apart from the Settings screens so a link to
// Settings from the chat or the panel never pulls those screens into the launch bundle
import type { LocaleKey } from "@/locales";
import type { Action, AppSettingsSection } from "@/state/store";
import type { GrokIconName } from "@/components/GrokIcon";

export type AdvancedPage = "apps" | "bots" | "looks" | "team" | "data" | "builder" | "about";

export const ADVANCED_PAGES: ReadonlyArray<{ id: AdvancedPage; group: "bots" | "workspace" | "app"; icon: GrokIconName; sections: AppSettingsSection[] }> = [
  { id: "apps", group: "bots", icon: "plug", sections: ["apps", "skills"] },
  { id: "bots", group: "bots", icon: "robot", sections: ["bots"] },
  { id: "team", group: "workspace", icon: "building", sections: ["organization", "people", "workspaces"] },
  { id: "data", group: "workspace", icon: "database", sections: ["data", "backups", "import"] },
  { id: "looks", group: "app", icon: "palette", sections: ["looks"] },
  { id: "builder", group: "app", icon: "sliders", sections: ["builder", "experimental"] },
  { id: "about", group: "app", icon: "info", sections: ["about"] },
];

export type SettingsPane = "general" | "texting" | "computer" | "permissions" | "models" | "usage" | "updates" | "advanced";

/** Grok's panes with Models before its Usage & Billing, then Advanced features, which holds everything of ours Grok has no place for. */
export const SETTINGS_PANES: ReadonlyArray<{ id: SettingsPane; labelKey: LocaleKey; icon: GrokIconName; sections: readonly AppSettingsSection[] }> = [
  { id: "general", labelKey: "settings.section.general", icon: "settings-gear", sections: ["general", "appearance"] },
  { id: "texting", labelKey: "settings.pane.texting", icon: "chat-bubbles", sections: ["texting", "companion", "remote"] },
  { id: "computer", labelKey: "settings.simple.page.computer", icon: "display", sections: ["computer", "desktopWorkspaces"] },
  { id: "permissions", labelKey: "settings.pane.permissions", icon: "shield", sections: ["permissions", "botAccess", "logins", "activity"] },
  { id: "models", labelKey: "settings.pane.models", icon: "sparkle", sections: ["engines", "connections", "decisionModel"] },
  { id: "usage", labelKey: "settings.pane.usage", icon: "chart-bars", sections: ["usage", "cloudAccount"] },
  { id: "updates", labelKey: "settings.simple.page.updates", icon: "cloud-download", sections: ["updates"] },
  { id: "advanced", labelKey: "settings.pane.advanced", icon: "sliders", sections: ["advanced", ...ADVANCED_PAGES.flatMap((page) => page.sections)] },
];

export type SettingsLocation = { pane: SettingsPane; page?: AdvancedPage };

/** Where a section lives now: its pane, and inside Advanced its page. Every old deep link lands somewhere. */
export function settingsLocation(section: AppSettingsSection): SettingsLocation {
  const page = ADVANCED_PAGES.find((entry) => entry.sections.includes(section));
  if (page) return { pane: "advanced", page: page.id };
  return { pane: SETTINGS_PANES.find((pane) => pane.sections.includes(section))?.id ?? "general" };
}

/** Pages that grew into their own pane: links to the old Advanced page still land. */
const MOVED_PAGES = { ai: "models", billing: "usage" } as const satisfies Record<string, SettingsPane>;

/** Open Settings at a pane, an Advanced page, or the section that holds a setting. */
export function openSettings(target: SettingsPane | AdvancedPage | keyof typeof MOVED_PAGES | AppSettingsSection = "general"): Action {
  const moved = (MOVED_PAGES as Record<string, SettingsPane>)[target];
  const pane = SETTINGS_PANES.find((entry) => entry.id === (moved ?? target));
  const page = ADVANCED_PAGES.find((entry) => entry.id === target);
  const section = pane ? pane.sections[0]! : page ? page.sections[0]! : (target as AppSettingsSection);
  return { type: "toggleAppSettings", open: true, section };
}
