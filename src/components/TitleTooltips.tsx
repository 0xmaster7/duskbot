import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Grok's tooltip timing: about 300ms on a first hover, then instant while the pointer moves between triggers. */
export const TOOLTIP_DELAY_MS = 300;
const GROUP_MS = 400;
const GAP = 8;
const EDGE = 8;
const TOOLTIP_ID = "app-title-tooltip";

interface Tip { el: HTMLElement; text: string; instant: boolean }

/**
 * Draws every native `title` as Grok's tooltip instead of the system one. While a trigger is hovered or focused its
 * title moves to `data-tip-title` (so the system tooltip stays away) and comes back when it closes; an icon-only
 * control keeps its name through a temporary aria-label. Mounted once beside the app.
 */
export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; side: "top" | "bottom" } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let pending: { el: HTMLElement; timer: number } | null = null;
    let shown: HTMLElement | null = null;
    let lastHidden = 0;
    let poll = 0;

    const strip = (el: HTMLElement): string | null => {
      const title = el.getAttribute("title");
      if (title == null) return el.dataset.tipTitle ?? null;
      if (!title.trim()) return null;
      el.dataset.tipTitle = title;
      el.removeAttribute("title");
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !el.textContent?.trim()) {
        el.setAttribute("aria-label", title);
        el.dataset.tipLabel = "";
      }
      return title;
    };
    const restore = (el: HTMLElement) => {
      const title = el.dataset.tipTitle;
      if (title == null) return;
      if (!el.hasAttribute("title")) el.setAttribute("title", title);
      if ("tipLabel" in el.dataset) { el.removeAttribute("aria-label"); delete el.dataset.tipLabel; }
      if (el.getAttribute("aria-describedby") === TOOLTIP_ID) el.removeAttribute("aria-describedby");
      delete el.dataset.tipTitle;
    };
    const cancel = () => {
      if (pending) { window.clearTimeout(pending.timer); restore(pending.el); pending = null; }
    };
    const hide = () => {
      cancel();
      window.clearInterval(poll);
      if (shown) { restore(shown); shown = null; lastHidden = Date.now(); }
      setTip(null);
    };
    const show = (el: HTMLElement, instant: boolean) => {
      const text = el.dataset.tipTitle;
      if (!text || !el.isConnected) return;
      shown = el;
      if (!el.hasAttribute("aria-describedby")) el.setAttribute("aria-describedby", TOOLTIP_ID);
      setTip({ el, text, instant });
      window.clearInterval(poll);
      // a trigger that unmounts under the pointer sends no pointerout
      poll = window.setInterval(() => { if (!el.isConnected) hide(); }, 250);
    };
    const arm = (el: HTMLElement) => {
      if (shown === el || pending?.el === el) return;
      hide();
      if (strip(el) == null) return;
      const instant = Date.now() - lastHidden < GROUP_MS;
      if (instant) { show(el, true); return; }
      pending = { el, timer: window.setTimeout(() => { pending = null; show(el, false); }, TOOLTIP_DELAY_MS) };
    };
    const trigger = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>("[title], [data-tip-title]") : null;

    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const el = trigger(event.target);
      if (el && el !== document.body && el !== document.documentElement) arm(el);
    };
    const onOut = (event: PointerEvent) => {
      const el = shown ?? pending?.el;
      if (!el) return;
      const next = event.relatedTarget;
      if (next instanceof Node && el.contains(next)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = trigger(event.target);
      if (el && el === event.target && el.matches(":focus-visible")) arm(el);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && (shown || pending)) hide(); };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // below the trigger and centred on it, above when there is no room, held 8px inside the window
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setPlace(null); return; }
    const anchor = tip.el.getBoundingClientRect();
    const box = tipRef.current.getBoundingClientRect();
    const below = anchor.bottom + GAP + box.height <= window.innerHeight - EDGE;
    const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - box.height);
    const left = Math.min(Math.max(EDGE, anchor.left + anchor.width / 2 - box.width / 2), window.innerWidth - EDGE - box.width);
    setPlace({ left, top, side: below ? "bottom" : "top" });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      data-side={place?.side ?? "bottom"}
      data-instant={tip.instant ? "" : undefined}
      className="ui-tooltip"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
