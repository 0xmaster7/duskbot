import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/cn";
import { SPRING_UI } from "@/lib/motion-presets";
import { usePrefersReducedMotion } from "./mascot-clock";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import type { MarkState } from "./mascot-motion-mark";

/** A room's members as a small overlapping stack of faces, at most `max` and then "+N". A member at work comes first and
 * plays its working state; the rest hold still in `rest`. `ground` paints a disc behind each face in the surface's own
 * colour (a css colour), so a face cuts cleanly over the one before it and the +N chip is ringed in that colour, not the app's. `motion` lets faces join and leave the stack, the rest gliding
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
  const surface = ground ?? "var(--color-app)";
  const disc = (index: number) => ({ ...(ground ? { backgroundColor: ground } : {}), ...(index > 0 ? { marginInlineStart: -overlap } : {}) });
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
              className="relative inline-flex rounded-full"
              style={disc(index)}
            >
              {face(member)}
            </motion.span>
          ))}
        </AnimatePresence>
      ) : shown.map((member, index) => (
        <span key={member.id} className="relative inline-flex rounded-full" style={disc(index)}>
          {face(member)}
        </span>
      ))}
      {more > 0 && (
        <span
          data-bot-faces-more=""
          className="relative flex shrink-0 items-center justify-center rounded-full font-medium leading-none tabular-nums text-ink-secondary"
          style={{ backgroundColor: `color-mix(in srgb, ${surface}, var(--color-ink) 7%)`, boxShadow: `0 0 0 2px ${surface}`, height: chip, minWidth: chip, paddingInline: Math.round(chip / 7), marginInlineStart: -Math.round(overlap * 0.6), fontSize: Math.max(11, Math.round(size * 0.34)) }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
