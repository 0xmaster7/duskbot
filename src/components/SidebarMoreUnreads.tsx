import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

type Edge = "top" | "bottom";

const UNREAD_ROW = "[data-sidebar-bot-row][data-row-unread]";

/** Grok's "More unreads" pill: while an unread bot is scrolled out of the list on this edge, a blue pill sticks to it, and
 * a click brings the nearest such bot into view. Placed first (top) or last (bottom) inside the scrolling list. */
export function SidebarMoreUnreads({ edge }: { edge: Edge }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const scroller = anchor.current?.closest<HTMLElement>(".overflow-y-auto");
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = scroller.getBoundingClientRect();
        const rows = [...scroller.querySelectorAll<HTMLElement>(UNREAD_ROW)];
        const out = edge === "top"
          ? rows.filter((row) => row.getBoundingClientRect().bottom <= box.top + 4).at(-1)
          : rows.find((row) => row.getBoundingClientRect().top >= box.bottom - 4);
        setHidden(out ?? null);
      });
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    const changes = new MutationObserver(measure);
    changes.observe(scroller, { subtree: true, attributes: true, attributeFilter: ["data-row-unread"], childList: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener("scroll", measure); resize.disconnect(); changes.disconnect(); };
  }, [edge]);
  return (
    <div ref={anchor} data-sidebar-more-unreads={edge} className={cn("pointer-events-none sticky z-20 flex h-0 justify-center", edge === "top" ? "top-2 -mb-2.5" : "bottom-2 -mt-2.5 items-end")}>
      {hidden && (
        <button
          type="button"
          onClick={() => hidden.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
          className="pointer-events-auto flex h-7 shrink-0 animate-pop-in items-center gap-0.5 rounded-full bg-[#0b6dd3] py-1 pl-1 pr-2 text-[13px] leading-[18px] tracking-[0.015em] text-white shadow-[0_1px_3px_0_rgba(28,28,28,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span aria-hidden="true" className="flex size-5 items-center justify-center">
            <Icon name={edge === "top" ? "arrow-up" : "arrow-down"} size={12} />
          </span>
          <span className="pe-0.5">{t("sidebar.grok.moreUnreads")}</span>
        </button>
      )}
    </div>
  );
}
