import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP } from "@/lib/motion-presets";

/** Grok's tooltip timing, measured in its renderer: 300ms on a first hover; leaving holds it 100ms, then it fades out
 * over 100ms. A trigger reached while one is still up shows at once, unanimated, as does one reached by keyboard. */
export const TOOLTIP_DELAY_MS = TOOLTIP.openDelay;
const TOOLTIP_CLOSE_DELAY_MS = TOOLTIP.closeDelay;
const TOOLTIP_EXIT_MS = TOOLTIP.exit;
const GAP = 8;
const EDGE = 8;
const TOOLTIP_ID = "app-title-tooltip";

interface Tip { el: HTMLElement; text: string; instant: boolean; ending?: boolean }

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
    let closing = 0;
    let ending = 0;
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
    const stopClosing = () => {
      window.clearTimeout(closing); closing = 0;
      window.clearTimeout(ending); ending = 0;
    };
    // gone now: scroll, blur, a trigger that left the page, or a newer tooltip taking over
    const hide = () => {
      cancel();
      stopClosing();
      window.clearInterval(poll);
      if (shown) { restore(shown); shown = null; }
      setTip(null);
    };
    // Grok's close: the tip fades out from where it is, and a trigger reached meanwhile still opens at once
    const fade = () => {
      if (!shown) return;
      window.clearTimeout(closing); closing = 0;
      if (ending) return;
      setTip((current) => (current ? { ...current, ending: true } : current));
      ending = window.setTimeout(hide, TOOLTIP_EXIT_MS);
    };
    const leave = () => {
      cancel();
      if (!shown || closing || ending) return;
      closing = window.setTimeout(fade, TOOLTIP_CLOSE_DELAY_MS);
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
    const arm = (el: HTMLElement, keyboard = false) => {
      if (shown === el) {
        // back on the trigger before it finished closing: keep it
        if (closing) { window.clearTimeout(closing); closing = 0; }
        if (ending) { stopClosing(); setTip((current) => (current ? { ...current, ending: false, instant: true } : current)); }
        return;
      }
      if (pending?.el === el) return;
      const warm = shown !== null;
      hide();
      if (strip(el) == null) return;
      if (warm || keyboard) { show(el, true); return; }
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
      leave();
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = trigger(event.target);
      if (el && el === event.target && el.matches(":focus-visible")) arm(el, true);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && (shown || pending)) { cancel(); fade(); } };
    const onPress = () => { cancel(); fade(); };
    const onFocusOut = () => { cancel(); if (shown && !closing && !ending) fade(); };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // below the trigger and centred on it, above when there is no room, held 8px inside the window
  const anchorEl = tip?.el;
  const anchorText = tip?.text;
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setPlace(null); return; }
    const anchor = tip.el.getBoundingClientRect();
    const box = tipRef.current.getBoundingClientRect();
    const below = anchor.bottom + GAP + box.height <= window.innerHeight - EDGE;
    const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - box.height);
    const left = Math.min(Math.max(EDGE, anchor.left + anchor.width / 2 - box.width / 2), window.innerWidth - EDGE - box.width);
    setPlace({ left, top, side: below ? "bottom" : "top" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorEl, anchorText]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      data-side={place?.side ?? "bottom"}
      data-instant={tip.instant ? "" : undefined}
      data-ending={tip.ending ? "" : undefined}
      className="ui-tooltip"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
