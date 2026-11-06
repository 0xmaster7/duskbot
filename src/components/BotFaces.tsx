import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import type { MarkState } from "./mascot-motion-mark";

/** A room's members as a small overlapping stack of faces, at most `max` and then "+N". A member at work comes first and
 * plays its working state; the rest hold still in `rest`. `ground` paints a disc behind each face in the surface's own
 * colour, so a face cuts cleanly over the one before it. */
export function BotFaces({ members, size, max = 3, working, rest = "idle", overlap = Math.round(size * 0.3), ground, className }: {
  members: readonly Bot[];
  size: number;
  max?: number;
  working?: ReadonlySet<string>;
  rest?: MarkState;
  overlap?: number;
  ground?: string;
  className?: string;
}) {
  const busy = (bot: Bot) => working?.has(bot.id) ?? false;
  const shown = [...members].sort((a, b) => Number(busy(b)) - Number(busy(a))).slice(0, max);
  const more = members.length - shown.length;
  const chip = Math.round(size * 0.84);
  return (
    <span data-bot-faces="" className={cn("flex shrink-0 items-center", className)}>
      {shown.map((member, index) => (
        <span key={member.id} className={cn("relative inline-flex rounded-full", ground)} style={index > 0 ? { marginInlineStart: -overlap } : undefined}>
          <BotAvatar bot={member} size={size} state={busy(member) ? "working" : rest} animated={busy(member)} trackPointer={false} />
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
