import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MausState } from "@/lib/mascot";
import type { Bot } from "../data/types";
import type { MausColor } from "../../../shared/wire";
import type { BotBodyId } from "../../../shared/bot-body";
import { cx } from "./kit";

const MausAvatar = lazy(() => import("@/components/Avatar").then((m) => ({ default: m.MausAvatar })));

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const useReducedMotion = () =>
  useSyncExternalStore((fn) => { query?.addEventListener("change", fn); return () => query?.removeEventListener("change", fn); }, () => query?.matches ?? false, () => false);

export function Mascot({ color, body, size = 28, state = "idle", label, still, track = false, eager = false }: { color: MausColor; body?: BotBodyId; size?: number; state?: MausState; label?: string; still?: boolean; track?: boolean; eager?: boolean }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <span ref={ref} className="inline-flex shrink-0" style={{ width: size, height: size }}>
      {visible && <Suspense fallback={null}><MausAvatar color={color} bodyId={body} size={size} state={state} label={label} animated={!still && !reduced} trackPointer={track} personality={!still} /></Suspense>}
    </span>
  );
}

export function BotMark({ bot, size = 24, state, still = true }: { bot: Pick<Bot, "color" | "body" | "name">; size?: number; state?: MausState; still?: boolean }) {
  return (
    <span aria-hidden className="inline-flex shrink-0">
      <Mascot color={bot.color} body={bot.body} size={size} state={state} still={still} />
    </span>
  );
}

export function BotStack({ bots, size = 20 }: { bots: Array<Pick<Bot, "id" | "color" | "body" | "name">>; size?: number }) {
  return (
    <span className="flex items-center" aria-label={bots.map((b) => b.name).join(", ")} role="img">
      {bots.map((b, i) => (
        <span key={b.id} className={cx("rounded-full bg-surface ring-2 ring-surface", i > 0 && "-ms-1.5")}><BotMark bot={b} size={size} /></span>
      ))}
    </span>
  );
}

export function EmptyState({ color = "blue", body = "cloud", state = "curious", title, children, action }: { color?: MausColor; body?: BotBodyId; state?: MausState; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Mascot color={color} body={body} size={56} state={state} label={title} />
      <p className="mt-4 text-14 font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-[42ch] text-13 text-ink-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
