import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../../Avatar";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { connectAppsState, subscribeConnectApps } from "../../connect-apps/open";
import { GrokIcon, type GrokIconName } from "../../GrokIcon";
import { DialogPane, useDialogKeys } from "../../ui/GrokDialog";
import { PanelModal } from "./PanelModals";
import { SHEET_PAGES, type SheetPage } from "./panel-modal";
import "../../../styles/settings.css";

const ICON: Record<SheetPage, GrokIconName> = {
  instructions: "pencil-square",
  memory: "brain",
  skills: "skills",
  identity: "person-circle",
  tools: "wrench",
  permissions: "shield",
  folder: "folder",
  where: "laptop",
  backups: "stack",
  slack: "logo-slack",
};

export function sheetLabel(page: SheetPage, bot: Bot): string {
  switch (page) {
    case "instructions": return t("botSettings.simple.instructions");
    case "memory": return t("botPanel.memoryRow");
    case "skills": return t("botSettings.simple.skills");
    case "identity": return t("botSettings.sections.identity");
    case "tools": return t("botPanel.page.tools");
    case "permissions": return t("botSettings.sections.permissions");
    case "folder": return t("computer.files.folder");
    case "where": return t("computer.simple.whereWorks", { name: bot.name });
    case "backups": return t("botPanel.page.backups");
    case "slack": return t("botPanel.page.slack");
  }
}

const STEP: Record<string, (at: number, last: number) => number> = {
  ArrowDown: (at, last) => (at === last ? 0 : at + 1),
  ArrowUp: (at, last) => (at === 0 ? last : at - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/** The bot's own settings in Grok's settings sheet: the bot over a rail of its pages, the chosen page beside it. Slack
 * is a page only while Admin manages this bot's Slack app. */
export function BotSheet({ initial, bot, derived, slackUrl = null, onClose }: {
  initial: SheetPage;
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  slackUrl?: string | null;
  onClose: () => void;
}) {
  const pages = SHEET_PAGES.filter((entry) => entry !== "slack" || slackUrl);
  const [chosen, setPage] = useState(initial);
  const page = pages.includes(chosen) ? chosen : pages[0]!;
  const dialog = useRef<HTMLDivElement>(null);
  const close = useDialogKeys(dialog, onClose);

  // connect apps opens over the window, not over this sheet: a link to it hands over
  useEffect(() => subscribeConnectApps(() => {
    if (connectAppsState().open) close.current();
  }), [close]);

  const onRailKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = STEP[event.key];
    if (!step || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const next = pages[step(pages.indexOf(page), pages.length - 1)]!;
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
            {pages.map((entry) => (
              <button
                key={entry}
                type="button"
                data-bot-sheet-page={entry}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => setPage(entry)}
                className="settings-nav-item"
              >
                <GrokIcon name={ICON[entry]} size={15} />
                <span>{sheetLabel(entry, bot)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-panel" data-settings-look="simple">
            <button type="button" onClick={() => close.current()} aria-label={t("common.close")} className="settings-close">
              <GrokIcon name="close" size={14} />
            </button>
            <DialogPane.Provider value>
              <PanelModal key={page} page={page} bot={bot} derived={derived} slackUrl={slackUrl} onClose={() => close.current()} />
            </DialogPane.Provider>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
