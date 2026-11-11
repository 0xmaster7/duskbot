import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./kit";
import { useReducedMotion } from "./Mascot";

const FADE = [{ opacity: 0.35 }, { opacity: 1 }];
const TICK_MS = 520;

interface Parsed { prefix: string; n: number; suffix: string; decimals: number; grouped: boolean }

/** "$1,204.50" as its parts, so a change can count through the numbers in between */
export function parseFigure(text: string): Parsed | null {
  const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
  if (!m) return null;
  const raw = m[2]!, n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return { prefix: m[1]!, n, suffix: m[3]!, decimals: raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0, grouped: raw.includes(",") };
}

export function formatFigure(n: number, like: Parsed): string {
  return `${like.prefix}${n.toLocaleString("en-US", { minimumFractionDigits: like.decimals, maximumFractionDigits: like.decimals, useGrouping: like.grouped })}${like.suffix}`;
}

/** a big number; when it changes it counts to the new value, and a change of unit fades instead */
export function Figure({ value, className }: { value: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string | null>(null);
  const at = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const text = typeof value === "string" || typeof value === "number" ? String(value) : null;
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = text;
    const el = ref.current, node = el?.firstChild;
    const to = text === null ? null : parseFigure(text);
    const from = before === null ? null : parseFigure(before);
    const start = at.current ?? from?.n ?? null;
    at.current = to?.n ?? null;
    if (!el || before === null || text === null || before === text) return;
    const counts = !reduced && to && from && start !== null && node?.nodeType === Node.TEXT_NODE && from.prefix === to.prefix && from.suffix === to.suffix && typeof requestAnimationFrame === "function";
    if (!counts) { el.animate?.(FADE, { duration: 200, easing: "ease" }); return; }
    const like = { ...to, grouped: to.grouped || from.grouped }, t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / TICK_MS), eased = 1 - (1 - p) ** 3, n = start + (to.n - start) * eased;
      at.current = n;
      node.nodeValue = p < 1 ? formatFigure(n, like) : text;
      if (p < 1) frame = requestAnimationFrame(step);
    };
    node.nodeValue = formatFigure(start, like);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, reduced]);
  const word = text !== null && !/\d/.test(text);
  return <span ref={ref} className={cx("inline-block max-w-full truncate", word ? "text-[28px] font-medium leading-9 tracking-[-0.035em] text-ink" : "t-figure", className)}>{value}</span>;
}
