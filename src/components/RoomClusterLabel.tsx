import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { MAUS_COLOR_NAMES, normalizeState, type MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";

function isPaletteColor(color: string): color is MausColor {
  return (MAUS_COLOR_NAMES as readonly string[]).includes(color);
}

export function ClusterLabel({ bot, name, color }: { bot?: Bot; name: string; color: string }) {
  const known = isPaletteColor(color);
  return (
    <div className="flex h-4 items-center gap-1.5 ps-1">
      <BotAvatar
        bot={bot ?? { name, color: color as Bot["color"] }}
        state={normalizeState(bot?.mascotExpression) ?? "happy"}
        size={16}
        motion="none"
        motionKey={0}
        animated={false}
        readable={known}
      />
      <span
        className={cn("truncate text-[12px] font-medium leading-4", known ? "bot-identity" : "text-ink-secondary")}
        data-bot-color={known ? color : undefined}
      >{name}</span>
    </div>
  );
}
