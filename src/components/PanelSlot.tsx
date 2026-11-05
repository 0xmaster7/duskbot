import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Grok Bot's docked info pane, at its 320px: the column's width grows from 0 (and back) while the chat beside it reflows,
 * its content pinned to the column's left edge so it slides in from the window's right. */
export const PANEL_WIDTH = 320;
const DURATION_MS = 300;

/** The chat keeps at least this much beside a docked pane, as in Grok Bot; narrower, the pane cannot dock. */
export const CHAT_MIN_WIDTH = 424;

/** Below md the panel is its own full-screen sheet, so the slot steps aside there. */
export function PanelSlot({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const slot = useRef<HTMLDivElement>(null);
  // Open from the start (a reload with the panel open): it is simply there, with nothing to grow from.
  const instant = useRef(open);
  // The content it last showed stays while the column closes over it.
  const last = useRef(children);
  if (open) last.current = children;
  if (open && !mounted) setMounted(true);
  // The width is set on the element before paint, not through state: the column starts moving in the frame it is asked to.
  useLayoutEffect(() => {
    const el = slot.current;
    if (!el) return;
    if (instant.current) { instant.current = false; el.style.width = `${PANEL_WIDTH}px`; return; }
    if (open && el.style.width !== `${PANEL_WIDTH}px`) {
      el.style.width = "0px";
      void el.offsetWidth;
    }
    el.style.width = `${open ? PANEL_WIDTH : 0}px`;
  }, [open, mounted]);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), DURATION_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!mounted) return null;
  return (
    <div
      ref={slot}
      data-panel-slot={open ? "open" : "closing"}
      inert={!open}
      className="relative h-full w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none max-md:contents"
    >
      <div className="absolute inset-y-0 left-0 flex w-[320px] max-md:contents md:[&>aside]:animate-none!">
        {open ? children : last.current}
      </div>
    </div>
  );
}
