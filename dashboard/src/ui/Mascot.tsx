import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MausState } from "@/lib/mascot";
import { isMausColor, type MausColor } from "../../../shared/wire";
import type { BotBodyId } from "../../../shared/bot-body";
import type { BotReport } from "../../../shared/dashboard-protocol";
import { cx } from "./kit";

const PageMark = lazy(() => import("./LeanMark"));

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const useReducedMotion = () =>
  useSyncExternalStore((fn) => { query?.addEventListener("change", fn); return () => query?.removeEventListener("change", fn); }, () => query?.matches ?? false, () => false);

export const colorOf = (c: string | null | undefined): MausColor => (isMausColor(c) ? c : "blue");
export const bodyOf = (b: string | null | undefined) => (b ?? undefined) as BotBodyId | undefined;

/** the app's own mascot; mounts as it nears the viewport, stops drawing off screen and rests still under reduced motion */
export function Mascot({ color, body, size = 28, state = "idle", label, still = false, track = false, className }: { color: MausColor; body?: BotBodyId; size?: number; state?: MausState; label?: string; still?: boolean; track?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  const live = !still && !reduced;
  return (
    <span ref={ref} className={cx("inline-flex shrink-0", className)} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {shown && (
        <Suspense fallback={null}>
          <PageMark color={color} body={body} size={size} state={state} live={live} track={track && live} />
        </Suspense>
      )}
    </span>
  );
}

export function BotMascot({ bot, size = 28, still = true, track = false }: { bot: Pick<BotReport, "color" | "body" | "busy">; size?: number; still?: boolean; track?: boolean }) {
  return <Mascot color={colorOf(bot.color)} body={bodyOf(bot.body)} size={size} state={bot.busy ? "working" : "idle"} still={still && !bot.busy} track={track} />;
}
