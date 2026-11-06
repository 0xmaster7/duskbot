import { useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { GrokIcon, type GrokIconName } from "../GrokIcon";
import { DialogPane, useDialogKeys } from "../ui/GrokDialog";
import { RoomAboutModal, RoomFolderModal, RoomInstructionsModal, RoomResponderModal, type RoomDialog } from "./RoomModals";
import "../../styles/settings.css";
import "../bot-panel/modals/bot-sheet.css";

const PAGES: readonly RoomDialog[] = ["instructions", "responder", "folder", "about"];

const ICON: Record<RoomDialog, GrokIconName> = {
  instructions: "pencil-square",
  responder: "chat-bubbles",
  folder: "folder",
  about: "pencil",
};

const LABEL: Record<RoomDialog, () => string> = {
  instructions: () => t("room.panel.instructions"),
  responder: () => t("room.panel.whoResponds"),
  folder: () => t("room.folder.title"),
  about: () => t("room.panel.about"),
};

const STEP: Record<string, (at: number, last: number) => number> = {
  ArrowDown: (at, last) => (at === last ? 0 : at + 1),
  ArrowUp: (at, last) => (at === 0 ? last : at - 1),
  Home: () => 0,
  End: (_, last) => last,
};

/** The room's settings in the bot's settings sheet: the room over a rail of its pages, the chosen page beside it. */
export function RoomSheet({ initial, group, members, onClose }: { initial: RoomDialog; group: Group; members: Bot[]; onClose: () => void }) {
  const [page, setPage] = useState(initial);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useDialogKeys(dialog, onClose);
  const lead = members[0];

  const onRailKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = STEP[event.key];
    if (!step || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const next = PAGES[step(PAGES.indexOf(page), PAGES.length - 1)]!;
    setPage(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-room-sheet-page="${next}"]`)?.focus();
  };
  const done = () => close.current();

  return createPortal(
    <div className="settings-scrim" data-room-sheet onMouseDown={(event) => event.target === event.currentTarget && close.current()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={group.name} tabIndex={-1} className="settings-dialog">
        <div className="settings-layout">
          <nav aria-label={group.name} className="settings-nav" onKeyDown={onRailKey}>
            <div className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 pl-[7px] pr-[9px]">
              {lead && <BotAvatar bot={lead} size={20} animated={false} />}
              <span className="truncate text-[13px] font-medium leading-[18px] tracking-[0.015em]">{group.name}</span>
            </div>
            <div aria-hidden="true" className="h-2 shrink-0" />
            {PAGES.map((entry) => (
              <button
                key={entry}
                type="button"
                data-room-sheet-page={entry}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => setPage(entry)}
                className="settings-nav-item"
              >
                <GrokIcon name={ICON[entry]} size={15} />
                <span>{LABEL[entry]()}</span>
              </button>
            ))}
          </nav>
          <div className="settings-panel">
            <button type="button" onClick={done} aria-label={t("common.close")} className="settings-close">
              <GrokIcon name="close" size={14} />
            </button>
            <DialogPane.Provider value>
              {page === "instructions" && <RoomInstructionsModal key={page} group={group} onClose={done} />}
              {page === "responder" && <RoomResponderModal key={page} group={group} members={members} onClose={done} />}
              {page === "folder" && <RoomFolderModal key={page} group={group} onClose={done} />}
              {page === "about" && <RoomAboutModal key={page} group={group} onClose={done} />}
            </DialogPane.Provider>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
