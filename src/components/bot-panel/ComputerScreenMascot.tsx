import type { Bot } from "@/state/store";
import { MausAvatar } from "../Avatar";
import "./computer-tab.css";

const ASLEEP_GREY = "color-mix(in srgb, var(--color-ink) 56%, transparent)";
export const COMPUTER_FRAME_CLASS = "relative flex w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] text-center text-[13px] leading-[18px] tracking-[0.015em] shadow-[inset_0_0_0_0.5px_var(--color-edge)]";

export function AsleepMascot({ bot }: { bot: Bot }) {
  return (
    <span data-asleep-mascot="" className="relative flex size-8">
      <span className="computer-asleep-breathe flex">
        <MausAvatar color={bot.color} bodyId={bot.mascotBody ?? undefined} gradient={[ASLEEP_GREY, ASLEEP_GREY, ASLEEP_GREY]} size={32} state="sleeping" label={bot.name} />
      </span>
      <span aria-hidden="true" className="absolute inset-[4px_4px_28px_28px]">
        {[0, 4, 8].map((left) => <span key={left} className="computer-asleep-z" style={{ left }} />)}
      </span>
    </span>
  );
}
