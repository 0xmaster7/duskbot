import { useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../../Avatar";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { GrokIcon, type GrokIconName } from "../../GrokIcon";
import { DialogPane, useDialogKeys } from "../../ui/GrokDialog";
import { PanelModal } from "./PanelModals";
import { MODAL_PAGES, type ModalPage } from "./panel-modal";
import "../../../styles/settings.css";

const ICON: Record<ModalPage, GrokIconName> = {
  instructions: "pencil-square",
  memory: "brain",
  skills: "skills",
  folder: "folder",
  where: "laptop",
  backups: "stack",
};

function label(page: ModalPage, bot: Bot): string {
  switch (page) {
    case "instructions": return t("botSettings.simple.instructions");
    case "memory": return t("botPanel.memoryRow");
    case "skills": return t("botSettings.simple.skills");
    case "folder": return t("computer.files.folder");
    case "where": return t("computer.simple.whereWorks", { name: bot.name });
    case "backups": return t("botPanel.page.backups");
  }
}

const STEP: Record<string, (at: number, last: number) => number> = {
  ArrowDown: (at, last) => (at === last ? 0 : at + 1),
  ArrowUp: (at, last) => (at === 0 ? last : at - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/** The bot's own settings in Grok's settings sheet: the bot over a rail of its pages, the chosen page beside it. */
export function BotSheet({ initial, bot, derived, onClose }: {
  initial: ModalPage;
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const [page, setPage] = useState(initial);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useDialogKeys(dialog, onClose);

  const onRailKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = STEP[event.key];
    if (!step || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const next = MODAL_PAGES[step(MODAL_PAGES.indexOf(page), MODAL_PAGES.length - 1)]!;
    setPage(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-bot-sheet-page="${next}"]`)?.focus();
  };

  return createPortal(
    <div className="settings-scrim" data-bot-sheet onMouseDown={(event) => event.target === event.currentTarget && close.current()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={bot.name} tabIndex={-1} className="settings-dialog">
        <div className="settings-layout">
          <nav aria-label={bot.name} className="settings-nav" onKeyDown={onRailKey}>
            <div className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 pl-[7px] pr-[9px]">
              <BotAvatar bot={bot} size={20} />
              <span className="truncate text-[13px] font-medium leading-[18px] tracking-[0.015em]">{bot.name}</span>
            </div>
            <div aria-hidden="true" className="h-2 shrink-0" />
            {MODAL_PAGES.map((entry) => (
              <button
                key={entry}
                type="button"
                data-bot-sheet-page={entry}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => setPage(entry)}
                className="settings-nav-item"
              >
                <GrokIcon name={ICON[entry]} size={15} />
                <span>{label(entry, bot)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-panel">
            <button type="button" onClick={() => close.current()} aria-label={t("common.close")} className="settings-close">
              <GrokIcon name="close" size={14} />
            </button>
            <DialogPane.Provider value>
              <PanelModal key={page} page={page} bot={bot} derived={derived} onClose={() => close.current()} />
            </DialogPane.Provider>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
