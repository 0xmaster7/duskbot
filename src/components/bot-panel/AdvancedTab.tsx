import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { openSettings } from "../SettingsModal";
import type { SimplePageId } from "./page-registry";
import { Card, LabelAction, NavRow } from "./rows";
import { SettingsPage } from "./SettingsPage";

/** Every native per-bot feature Grok's Details tab has no room for, in Grok's list language: the model and its usage,
 * the bot's own rows (each opening its page), its rare actions, then the app-wide Advanced features pane. */
export function AdvancedTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onOpen: (page: SimplePageId) => void;
}) {
  const { dispatch } = useStore();
  return (
    <div data-panel-tabpanel="advanced">
      <SettingsPage
        bot={bot}
        derived={derived}
        onOpen={onOpen}
        modelAction={<LabelAction data-panel-action="usage" onClick={() => dispatch(openSettings("usage"))}>{t("nativeUsage.banner.see")}</LabelAction>}
      />
      <Card anchor="advanced-features">
        <NavRow
          data-panel-row="advanced-features"
          title={t("settings.pane.advanced")}
          hint={t("botPanel.advancedFeatures.hint")}
          onClick={() => dispatch(openSettings("advanced"))}
        />
      </Card>
    </div>
  );
}
