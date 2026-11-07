import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { MausAvatar } from "../Avatar";
import "./computer-tab.css";

const ASLEEP_GREY = "color-mix(in srgb, var(--color-ink) 56%, transparent)";
const COVER_GREY = "rgb(255 255 255 / 0.88)";
const COMPUTER_FILL_CLASS = "flex flex-col items-center justify-center gap-1.5 bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] text-center text-[13px] leading-[18px] tracking-[0.015em]";
export const COMPUTER_FRAME_CLASS = `relative w-full overflow-hidden rounded-xl shadow-[inset_0_0_0_0.5px_var(--color-edge)] ${COMPUTER_FILL_CLASS}`;
/** Bot desktops are 1280x800; a frame waits in that shape so the screen lands edge to edge without a jump. */
export const COMPUTER_SCREEN_ASPECT = 16 / 10;

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

/** Grok's starting screen: the grey mascot plays its waking clip over a shimmering line, until the first frame lands.
 * `cover` is the dark full view; otherwise it fills the panel's frame. */
export function ComputerWaking({ bot, cover = false }: { bot: Pick<Bot, "name" | "color" | "mascotBody">; cover?: boolean }) {
  const grey = cover ? COVER_GREY : ASLEEP_GREY;
  return (
    <div data-computer-waking="" role="status" className={cn("pointer-events-none absolute inset-0 z-[3]", cover ? "flex flex-col items-center justify-center gap-2 bg-[rgb(20,20,20)] text-center" : COMPUTER_FILL_CLASS)}>
      <span data-waking-mascot="" className="flex">
        <MausAvatar color={bot.color} bodyId={bot.mascotBody ?? undefined} gradient={[grey, grey, grey]} size={cover ? 56 : 32} state="waking" label={bot.name} />
      </span>
      <span className={cn("max-w-[80%] text-pretty", cover ? "computer-waking-text text-[12px] leading-4" : "computer-waking-line font-medium")}>
        {t("computer.botWaking", { name: bot.name })}
      </span>
    </div>
  );
}
