import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, useMotionValue, type Transition } from "motion/react";

// the motion brief's (2026-11) token set: stiffness and damping at mass 1
export const SOFT: Transition = { type: "spring", stiffness: 260, damping: 24 };
export const FADE_IN: Transition = { type: "spring", stiffness: 420, damping: 32 };
const LEAD = { type: "spring" as const, stiffness: 620, damping: 36 };
const TRAIL = { type: "spring" as const, stiffness: 190, damping: 19 };

const still = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** a highlight that stretches to the item marked data-hl={target} inside its parent: the edge facing the move runs ahead
 * and the far edge catches up. it is one full-size layer cut down with clip-path, and sits under the labels (z-0). */
export function Highlight({ target, className, radius = 999 }: { target: string | null; className?: string; radius?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const l = useMotionValue(0), r = useMotionValue(0), t = useMotionValue(0), b = useMotionValue(0);
  const shown = useRef(false);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const host = el.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { shown.current = false; setSize((v) => v + 1); });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const pill = el.current, host = pill?.parentElement;
    if (!pill || !host) return;
    const paint = () => { pill.style.clipPath = `inset(${t.get()}px ${r.get()}px ${b.get()}px ${l.get()}px round ${radius}px)`; };
    const unsub = [l, r, t, b].map((v) => v.on("change", paint));
    const item = target === null ? null : host.querySelector<HTMLElement>(`[data-hl="${CSS.escape(target)}"]`);
    if (!item) { pill.style.opacity = "0"; shown.current = false; return () => unsub.forEach((u) => u()); }
    const W = host.clientWidth, H = host.clientHeight;
    const L = item.offsetLeft, R = W - item.offsetLeft - item.offsetWidth, T = item.offsetTop, B = H - item.offsetTop - item.offsetHeight;
    pill.style.opacity = "1";
    if (!shown.current || still()) {
      l.jump(L); r.jump(R); t.jump(T); b.jump(B); paint();
      shown.current = true;
      return () => unsub.forEach((u) => u());
    }
    const right = L > l.get(), down = T > t.get(), sideways = L !== l.get();
    const moves = [
      animate(l, L, sideways && right ? TRAIL : LEAD), animate(r, R, sideways && !right ? TRAIL : LEAD),
      animate(t, T, !sideways && down ? TRAIL : LEAD), animate(b, B, !sideways && !down ? TRAIL : LEAD),
    ];
    return () => { moves.forEach((m) => m.stop()); unsub.forEach((u) => u()); };
  }, [target, size, radius, l, r, t, b]);
  return <span ref={el} aria-hidden className={`pointer-events-none absolute inset-0 z-0 ${className ?? "bg-pop"}`} style={{ clipPath: "inset(50%)", opacity: 0 }} />;
}
