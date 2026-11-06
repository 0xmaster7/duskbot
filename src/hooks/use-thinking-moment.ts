import { useEffect, type RefObject } from "react";

import type { MarkReaction } from "@/components/mascot-personality";

/** The mark's own moment after a message is sent, before its words come in (STATUS_QUIET_MS): it hops as the line
 * appears, then looks around while it thinks. Reduced motion keeps the mark still (the mark ignores reactions then). */
export const THINKING_BEATS: readonly { at: number; react: MarkReaction }[] = [
  { at: 120, react: "hop" },
  { at: 1_050, react: "lookAround" },
];

export function useThinkingMoment(markRef: RefObject<{ react?: (kind: MarkReaction) => void } | null>, thinking: boolean): void {
  useEffect(() => {
    if (!thinking) return;
    const timers = THINKING_BEATS.map((beat) => setTimeout(() => markRef.current?.react?.(beat.react), beat.at));
    return () => timers.forEach(clearTimeout);
  }, [markRef, thinking]);
}
