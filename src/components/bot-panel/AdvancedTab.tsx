import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";
import { openSettings } from "@/lib/open-settings";
import { VoiceChatCard } from "./DetailsTab";
import { LibrarySection } from "./LibraryTab";
import { BotSheet } from "./modals/BotSheet";
import { takePanelModalRequest, usePanelModalRequest, type ModalPage } from "./modals/panel-modal";
import type { SimplePageId } from "./page-registry";
import { Card, NavRow, PanelSections } from "./rows";
import { SettingsPage } from "./SettingsPage";

/** Every native per-bot feature Grok's Details tab has no room for, in Grok's list language: what the bot made, its voice
 * chat, the bot's own rows (each opening the bot's settings sheet at its page), its rare actions, then the app-wide Advanced
 * features pane. A deep link to one of those pages lands here and opens the sheet there. */
export function AdvancedTab({ bot, derived, onOpen }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onOpen: (page: SimplePageId) => void;
}) {
  const { dispatch } = useStore();
  const [modal, setModal] = useState<ModalPage | null>(null);
  const request = usePanelModalRequest();

  useEffect(() => {
    if (!request) return;
    setModal(request.page);
    takePanelModalRequest(request);
  }, [request]);

  return (
    <PanelSections data-panel-tabpanel="advanced">
      <LibrarySection bot={bot} onOpen={onOpen} />
      <VoiceChatCard bot={bot} patch={derived.patch} />
      <SettingsPage bot={bot} derived={derived} onOpen={setModal} />
      <Card anchor="advanced-features">
        <NavRow
          data-panel-row="advanced-features"
          title={t("settings.pane.advanced")}
          onClick={() => dispatch(openSettings("advanced"))}
        />
      </Card>
      {modal && <BotSheet key={modal} initial={modal} bot={bot} derived={derived} onClose={() => setModal(null)} />}
    </PanelSections>
  );
}
