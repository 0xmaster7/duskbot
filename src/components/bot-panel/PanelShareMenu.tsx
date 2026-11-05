import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { ChatShareMenu } from "../ChatMoreMenu";
import { GrokIcon } from "../GrokIcon";
import { useMenuMotion } from "../MenuMotion";
import { useTeamName } from "../bot-access/ShareBotButton";
import { roundButtonCls } from "./rows";

const GAP = 4;

/** Grok's Share on the panel: one menu item, Create a copy, under the button's right edge. A team bot keeps the team
 * share (who can use it), and Copy and Download stay in the chat's ⋯ menu. */
export function PanelShareMenu({ bot }: { bot: Bot }) {
  const team = useTeamName();
  if (team) return <ChatShareMenu bot={bot} className={roundButtonCls} />;
  return <CopyMenu bot={bot} />;
}

function CopyMenu({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    setPlace({ top: box.bottom + GAP, right: window.innerWidth - box.right });
  }, [open]);

  useEffect(() => {
    if (open && place) item.current?.focus({ preventScroll: true });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-panel-share=""
        aria-label={t("chat.export.heading")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        className={roundButtonCls}
      >
        <GrokIcon name="arrow-bracket-from-up" size={16} />
      </button>
      {typeof document !== "undefined" && createPortal(
          motion.shown && place && (
            <div
              ref={menu}
              role="menu"
              aria-label={t("chat.export.heading")}
              data-panel-share-menu=""
              {...motion.exitProps}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
                else if (event.key === "Tab") close();
              }}
              style={{ top: place.top, right: place.right, transformOrigin: "right top" }}
              className={cn(motion.className, "fixed z-[2147482000] flex w-[230px] flex-col gap-0.5 rounded-2xl bg-menu p-1.5 text-[14px] leading-5 tracking-[0.01em] text-ink shadow-(--shadow-popover) outline-none")}
            >
              <button
                ref={item}
                type="button"
                role="menuitem"
                data-panel-share-item="copy"
                onClick={() => {
                  close(false);
                  dispatch({ type: "duplicateBot", botId: bot.id });
                }}
                className="relative flex w-full cursor-pointer items-center gap-2 px-1.5 py-[5px] text-left outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[10px] before:content-[''] hover:before:bg-ink/[0.06] focus-visible:before:bg-ink/[0.06]"
              >
                {/* grok draws the bot and its copy: the copy up and to the right, paler */}
                <span aria-hidden="true" className="relative size-10 shrink-0">
                  <span className="absolute right-0.5 top-0.5 flex opacity-55"><BotAvatar bot={bot} size={20} animated={false} trackPointer={false} /></span>
                  <span className="absolute bottom-0.5 left-0.5 flex"><BotAvatar bot={bot} size={20} animated={false} trackPointer={false} /></span>
                </span>
                <span className="relative flex min-w-0 flex-col">
                  <span className="truncate font-medium">{t("botPanel.share.copy")}</span>
                  <span className="truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{t("botPanel.share.copyHint")}</span>
                </span>
              </button>
            </div>
          ),
        document.body,
      )}
    </>
  );
}
