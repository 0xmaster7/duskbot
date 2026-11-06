import { useState } from "react";
import { t } from "@/lib/i18n";
import { CHAT_WIDTH_IDS, applyChatWidth, readChatWidth, type ChatWidthId } from "@/lib/chat-width";
import { FONT_IDS, applyFont, readFont, type FontId } from "@/lib/fonts";
import { parseSidebarToolsLayout, setSidebarToolsLayout, SIDEBAR_TOOLS_LAYOUTS, useSidebarToolsLayout } from "@/lib/sidebar-preferences";
import { SettingRow } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";

export function FontRow() {
  const [current, setCurrent] = useState<FontId>(readFont);
  return (
    <SettingRow title={t("settings.font.title")}>
      <SettingsSelect
        value={current}
        aria-label={t("settings.font.aria")}
        onChange={(event) => {
          // SAFETY: the options are rendered from FONT_IDS, so the value is always a member.
          const id = event.target.value as FontId;
          applyFont(id);
          setCurrent(id);
        }}
      >
        {FONT_IDS.map((id) => (
          <option key={id} value={id}>{t(`settings.font.${id}`)}</option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}

export function ChatWidthRow() {
  const [current, setCurrent] = useState<ChatWidthId>(readChatWidth);
  return (
    <SettingRow title={t("settings.chatWidth.title")}>
      <SettingsSelect
        value={current}
        aria-label={t("settings.chatWidth.aria")}
        onChange={(event) => {
          const id = CHAT_WIDTH_IDS.find((width) => width === event.target.value);
          if (!id) return;
          applyChatWidth(id);
          setCurrent(id);
        }}
      >
        {CHAT_WIDTH_IDS.map((id) => (
          <option key={id} value={id}>{t(`settings.chatWidth.${id}`)}</option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}

export function SidebarToolsLayoutRow() {
  const layout = useSidebarToolsLayout();
  return (
    <SettingRow title={t("sidebar.toolsLayout.title")}>
      <SettingsSelect
        value={layout}
        aria-label={t("sidebar.toolsLayout.chooseAria")}
        onChange={(event) => setSidebarToolsLayout(parseSidebarToolsLayout(event.target.value))}
      >
        {SIDEBAR_TOOLS_LAYOUTS.map((option) => (
          <option key={option} value={option}>{t(`sidebar.toolsLayout.${option}`)}</option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}
