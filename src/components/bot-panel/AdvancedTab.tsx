import { useEffect } from "react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { openBotSettings, openSettings } from "@/lib/open-settings";
import { VoiceChatCard } from "./DetailsTab";
import { LibrarySection } from "./LibraryTab";
import { takePanelModalRequest, usePanelModalRequest, type SheetPage } from "./modals/panel-modal";
import type { SimplePageId } from "./page-registry";
import { Card, NavRow, PanelSections } from "../ListRows";
import { SettingsPage } from "./SettingsPage";
import { usePanelLink } from "./panel-link";

// a link opens Settings once: a panel drawn again for the same link (it reads the link as it mounts) must not reopen it
let openedForLink = -1;

/** Every native per-bot feature Grok's Details tab has no room for, in Grok's list language: what the bot made, its voice
 * chat, the bot's own rows (each opening Settings' Bots page on this bot, at that row's page), its rare actions, then
 * the app-wide Advanced page. A deep link to one of those pages lands in Settings there. */
export function AdvancedTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onOpen: (page: SimplePageId) => void;
}) {
  const { dispatch } = useStore();
  const request = usePanelModalRequest();
  const link = usePanelLink();
  const openPage = (page: SheetPage) => dispatch(openBotSettings({ kind: "bot", id: bot.id, row: page }));

  useEffect(() => {
    if (!request) return;
    takePanelModalRequest(request);
    const linkNonce = link?.nonce ?? 0;
    if (linkNonce !== 0 && linkNonce === openedForLink) return;
    openedForLink = linkNonce;
    dispatch(openBotSettings({ kind: "bot", id: bot.id, row: request.page }));
  }, [request, link, bot.id, dispatch]);

  return (
    <PanelSections data-panel-tabpanel="advanced">
      <LibrarySection bot={bot} onOpen={onOpen} />
      <VoiceChatCard bot={bot} patch={derived.patch} />
      <SettingsPage bot={bot} derived={derived} onOpen={openPage} more={(
        <Card anchor="advanced-features">
          <NavRow
            data-panel-row="advanced-features"
            title={t("settings.pane.advanced")}
            onClick={() => dispatch(openSettings("advanced"))}
          />
        </Card>
      )} />
    </PanelSections>
  );
}
