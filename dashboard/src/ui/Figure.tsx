import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./kit";
import { useReducedMotion } from "./Mascot";

const ROLL = [{ opacity: 0, transform: "translateY(-5px)", filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }];
const FADE = [{ opacity: 0.35 }, { opacity: 1 }];

/** a big number; when its text changes it rolls in out of a short blur */
export function Figure({ value, className }: { value: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string | null>(null);
  const reduced = useReducedMotion();
  const text = typeof value === "string" || typeof value === "number" ? String(value) : null;
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = text;
    const el = ref.current;
    if (before === null || text === null || before === text || !el?.animate) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(reduced ? FADE : ROLL, { duration: reduced ? 160 : 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [text, reduced]);
  const word = text !== null && !/\d/.test(text);
  return <span ref={ref} className={cx("inline-block max-w-full truncate", word ? "text-[26px] font-medium leading-8 tracking-[-0.02em] text-ink" : "t-figure", className)}>{value}</span>;
}
