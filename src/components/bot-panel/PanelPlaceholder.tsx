import { useEffect } from "react";

import { t } from "@/lib/i18n";
import type { MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { GrokIcon } from "../GrokIcon";
import { Card, roundButtonCls } from "./rows";
import { PanelAdvancedTab, PanelDetailsTab } from "./PanelShell";
import { PANEL_TABS, TAB_LABEL } from "./page-registry";
import { sidePanelCls } from "./side-panel";

const LAST_PANEL_BOT_KEY = "openmausbot.botPanelLast.v1";

type PanelBot = Pick<Bot, "id" | "name" | "color" | "mascotBody" | "mascotFaceColor">;

/** The bot the panel last showed, so a reload with the panel open can draw it before the bots have loaded. */
export function rememberPanelBot(bot: PanelBot): void {
  const { id, name, color, mascotBody, mascotFaceColor } = bot;
  try { localStorage.setItem(LAST_PANEL_BOT_KEY, JSON.stringify({ id, name, color, mascotBody, mascotFaceColor })); } catch {}
}

export function readPanelBot(): PanelBot | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PANEL_BOT_KEY) ?? "null") as Partial<PanelBot> | null;
    return saved && typeof saved.id === "string" && typeof saved.name === "string" && typeof saved.color === "string"
      ? { id: saved.id, name: saved.name, color: saved.color as MausColor, mascotBody: saved.mascotBody ?? null, mascotFaceColor: saved.mascotFaceColor ?? null }
      : null;
  } catch {
    return null;
  }
}

const bar = "block rounded-md bg-ink/[0.06] motion-safe:animate-pulse";

/** The docked bot panel while the bots load: its frame, the last bot it showed, and rows where its cards will be. */
export function PanelPlaceholder({ onClose }: { onClose: () => void }) {
  const last = readPanelBot();
  useEffect(() => {
    void PanelDetailsTab.preload().catch(() => {});
    void PanelAdvancedTab.preload().catch(() => {});
  }, []);
  return (
    <aside data-panel-placeholder aria-busy="true" aria-label={last?.name} className={sidePanelCls(false)}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.5px] bg-edge max-md:hidden" />
        <div className="relative flex h-[60px] shrink-0 items-center gap-2 p-3">
          <span className="ms-auto" />
          <button type="button" onClick={onClose} aria-label={t("botPanel.close")} className={roundButtonCls}>
            <GrokIcon name="close" size={16} />
          </button>
        </div>
        <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col overflow-hidden px-4">
          <div className="flex flex-col items-center pb-3 pt-2">
            {last ? <BotAvatar bot={last} size={64} animated={false} trackPointer={false} /> : <span className={`${bar} size-16 rounded-full`} />}
            <div className="mt-4 flex h-[26px] items-center">
              {last ? <span className="truncate px-2.5 text-[17px] font-medium leading-6 tracking-[0.01em] text-ink">{last.name}</span> : <span className={`${bar} h-4 w-24`} />}
            </div>
          </div>
          <div className="flex justify-center gap-0.5 pb-2.5 pt-1">
            {PANEL_TABS.map((id) => (
              <span key={id} className="h-[26px] truncate rounded-full px-2 py-1 text-[13px] leading-[18px] text-ink-secondary">{t(TAB_LABEL[id])}</span>
            ))}
          </div>
          <div className="flex flex-col gap-3 pt-2.5">
            {[3, 2, 4].map((rows, card) => (
              <Card key={card}>
                <div className="flex flex-col gap-3 px-3 py-3">
                  {Array.from({ length: rows }, (_, row) => <span key={row} className={`${bar} h-3.5`} style={{ width: `${72 - ((row + card) % 3) * 14}%` }} />)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
