import { useEffect, type RefObject } from "react";

import type { MarkReaction } from "@/components/mascot-personality";

export type ThinkingBeat = { at: number; react: MarkReaction };

/** The mark's own moment after a message is sent, before its words come in (STATUS_QUIET_MS): each send plays one of
 * these, never the same twice running, its later beats a little early or late. Reduced motion keeps the mark still
 * (the mark ignores reactions then). */
export const THINKING_MOMENTS: readonly (readonly ThinkingBeat[])[] = [
  [{ at: 120, react: "hop" }, { at: 1_050, react: "lookAround" }],
  [{ at: 140, react: "nod" }, { at: 760, react: "lookAround" }],
  [{ at: 110, react: "hop" }, { at: 900, react: "nod" }],
  [{ at: 180, react: "lookAround" }],
  [{ at: 120, react: "greet" }],
];
/** Later beats move by up to this share either way, and never past this time. */
export const BEAT_JITTER = 0.12;
export const LAST_BEAT_MS = 1_080;

let lastMoment = -1;

/** One moment, timed, for this send. */
export function pickThinkingMoment(random: () => number = Math.random): ThinkingBeat[] {
  const choices = THINKING_MOMENTS.map((_, index) => index).filter((index) => index !== lastMoment);
  lastMoment = choices[Math.floor(random() * choices.length)]!;
  return THINKING_MOMENTS[lastMoment]!.map((beat, index) => ({
    react: beat.react,
    at: index === 0 ? beat.at : Math.min(LAST_BEAT_MS, Math.round(beat.at * (1 + (random() * 2 - 1) * BEAT_JITTER))),
  }));
}

export function useThinkingMoment(markRef: RefObject<{ react?: (kind: MarkReaction) => void } | null>, thinking: boolean): void {
  useEffect(() => {
    if (!thinking) return;
    const timers = pickThinkingMoment().map((beat) => setTimeout(() => markRef.current?.react?.(beat.react), beat.at));
    return () => timers.forEach(clearTimeout);
  }, [markRef, thinking]);
}
