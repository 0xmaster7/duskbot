import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/cn";
import { SPRING_UI } from "@/lib/motion-presets";
import { usePrefersReducedMotion } from "./mascot-clock";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import type { MarkState } from "./mascot-motion-mark";

/** A room's members as a small overlapping stack of faces, at most `max` and then "+N". A member at work comes first and
 * plays its working state; the rest hold still in `rest`. `ground` paints a disc behind each face in the surface's own
 * colour, so a face cuts cleanly over the one before it. `motion` lets faces join and leave the stack, the rest gliding
 * over to make room; `stateOf` picks a working face's state and `eyeInk` its eye paint, as the status line's mark has. */
export function BotFaces({ members, size, max = 3, working, rest = "idle", overlap = Math.round(size * 0.3), ground, className, motion: moving = false, stateOf, eyeInk }: {
  members: readonly Bot[];
  size: number;
  max?: number;
  working?: ReadonlySet<string>;
  rest?: MarkState;
  overlap?: number;
  ground?: string;
  className?: string;
  motion?: boolean;
  stateOf?: (bot: Bot) => MarkState;
  eyeInk?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const busy = (bot: Bot) => working?.has(bot.id) ?? false;
  const shown = [...members].sort((a, b) => Number(busy(b)) - Number(busy(a))).slice(0, max);
  const more = members.length - shown.length;
  const chip = Math.round(size * 0.84);
  const face = (member: Bot) => (
    <BotAvatar bot={member} size={size} state={busy(member) ? (stateOf?.(member) ?? "working") : rest} animated={busy(member)} eyeInk={eyeInk} trackPointer={false} forward={false} />
  );
  return (
    <span data-bot-faces="" className={cn("flex shrink-0 items-center", className)}>
      {moving ? (
        <AnimatePresence initial={false}>
          {shown.map((member, index) => (
            <motion.span
              key={member.id}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
              transition={reduced ? { duration: 0.12 } : SPRING_UI}
              className={cn("relative inline-flex rounded-full", ground)}
              style={index > 0 ? { marginInlineStart: -overlap } : undefined}
            >
              {face(member)}
            </motion.span>
          ))}
        </AnimatePresence>
      ) : shown.map((member, index) => (
        <span key={member.id} className={cn("relative inline-flex rounded-full", ground)} style={index > 0 ? { marginInlineStart: -overlap } : undefined}>
          {face(member)}
        </span>
      ))}
      {more > 0 && (
        <span
          data-bot-faces-more=""
          className={cn("relative flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-app),var(--color-ink)_7%)] font-medium tabular-nums text-ink-secondary shadow-[0_0_0_2px_var(--color-app)]", ground)}
          style={{ height: chip, minWidth: chip, paddingInline: Math.round(chip / 7), marginInlineStart: -Math.round(overlap * 0.6), fontSize: Math.max(11, Math.round(size * 0.34)) }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
