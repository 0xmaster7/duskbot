// What the island and the dock share: one motion language, the feed from main, the pointer test that decides where
// clicks land, and a bot's mark.
import { useEffect, useRef, useState } from "react";
import { MausAvatar } from "@/components/Avatar";
import type { MarkState } from "@/components/mascot-motion-mark";
import type { BotBodyId } from "../../shared/bot-body";
import { say, type AmbientLabels } from "./say";
import type { AmbientBot, AmbientBridge, AmbientSnapshot, AmbientStatus, DockLayout, IslandLayout } from "./types";

/** Bencho's springs: settle for surfaces (no visible bounce), lively for small things that may overshoot. */
export const SETTLE = { type: "spring", stiffness: 380, damping: 34 } as const;
export const LIVELY = { type: "spring", stiffness: 500, damping: 18 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** Opacity runs on its own short clock, so a surface looks solid before it stops moving. */
export const FADE = { duration: 0.16, ease: EASE_OUT } as const;
export const FADE_OUT = { duration: 0.1, ease: EASE_OUT } as const;

export function useAmbientFeed(bridge: AmbientBridge): { snapshot: AmbientSnapshot | null; layout: IslandLayout | DockLayout | null } {
  const [snapshot, setSnapshot] = useState<AmbientSnapshot | null>(null);
  const [layout, setLayout] = useState<IslandLayout | DockLayout | null>(null);
  useEffect(() => {
    const offState = bridge.onState(setSnapshot);
    const offLayout = bridge.onLayout(setLayout);
    bridge.ready();
    return () => { offState(); offLayout(); };
  }, [bridge]);
  return { snapshot, layout };
}

/**
 * The window lets clicks through except over the surface's shape: the page still hears the pointer move (main forwards
 * it), tests it against `hit`, and tells main when it crosses the edge. `onEnter`/`onLeave` fire on that crossing.
 */
export function usePointerRegion(bridge: AmbientBridge, hit: (x: number, y: number) => boolean, onEnter: () => void, onLeave: () => void) {
  const inside = useRef(false);
  const latest = useRef({ hit, onEnter, onLeave });
  latest.current = { hit, onEnter, onLeave };
  useEffect(() => {
    const cross = (next: boolean) => {
      if (next === inside.current) return;
      inside.current = next;
      bridge.pointer(next);
      if (next) latest.current.onEnter(); else latest.current.onLeave();
    };
    const move = (event: MouseEvent) => cross(latest.current.hit(event.clientX, event.clientY));
    const leave = () => cross(false);
    document.addEventListener("mousemove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      document.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [bridge]);
  return inside;
}

const MARK: Record<AmbientStatus, MarkState> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  talking: "streaming",
  "needs-you": "blocked",
  done: "finished",
  error: "failed",
};
export const markState = (status: AmbientStatus): MarkState => MARK[status];

/** The bot's own mascot (or its picture), drawn still unless `animated`. */
export function BotMark({ bot, size, state, animated }: { bot: AmbientBot; size: number; state?: MarkState; animated: boolean }) {
  if (bot.avatar) return <img className="amb-photo" src={bot.avatar} alt="" width={size} height={size} draggable={false} style={{ borderRadius: Math.round(size * 0.3) }} />;
  return (
    <MausAvatar
      color={bot.color}
      bodyId={(bot.body ?? undefined) as BotBodyId | undefined}
      faceColor={bot.face}
      size={size}
      state={state ?? markState(bot.status)}
      animated={animated}
      trackPointer={false}
      personality={false}
      cueKey={bot.id}
    />
  );
}

/** A clock for "4m" that only ticks while someone can see it. */
export function useNow(active: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

/** A bot's state in words, with a dot in its colour: never colour alone. */
export function StatusTag({ status, labels }: { status: AmbientStatus; labels: AmbientLabels }) {
  return <span className="amb-tag" data-status={status}><span className="amb-dot" aria-hidden />{say(labels, status)}</span>;
}
