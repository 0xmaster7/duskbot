import type { MausColor } from "../../../shared/wire";
import { cx } from "./kit";
import { Mascot } from "./Mascot";
import { Stars } from "./Sky";

const CREW: Array<{ color: MausColor; state: "working" | "coding" | "running"; size: number; lift: number }> = [
  { color: "orange", state: "coding", size: 40, lift: 10 },
  { color: "blue", state: "working", size: 52, lift: 0 },
  { color: "green", state: "running", size: 40, lift: 16 },
];

/** the pitch in one picture: at night the Mac sleeps and its bot with it; the cloud desktop's crew keeps going */
export function Nightshift({ className, compact = false, time = "3:12 AM" }: { className?: string; compact?: boolean; time?: string }) {
  const h = compact ? "h-[188px]" : "h-[236px] max-sm:h-[200px]";
  return (
    <figure className={cx("grid grid-cols-2 overflow-hidden rounded-[14px] bg-bg", className)} aria-label="At night your Mac sleeps and its bots stop. A cloud desktop keeps them working.">
      <div className={cx("relative flex flex-col justify-between border-e border-line p-4", h)}>
        <Stars count={compact ? 8 : 12} seed={3} className="opacity-40" />
        <div className="relative flex items-center justify-between gap-2 text-12 text-ink-4">
          <span className="truncate">Your Mac</span>
          <span className="num shrink-0">{time}</span>
        </div>
        <div className="relative flex flex-1 items-end justify-center pb-2">
          <Mascot color="silver" size={compact ? 40 : 48} state="sleeping" />
        </div>
        <figcaption className="relative text-13 text-ink-3">Lid closed. Bots paused.</figcaption>
      </div>
      <div className={cx("relative flex flex-col justify-between p-4", h)}>
        <Stars count={compact ? 18 : 28} seed={11} />
        <div className="relative flex items-center justify-between gap-2 text-12 text-ink-3">
          <span className="truncate">Cloud desktop</span>
          <span className="num shrink-0">{time}</span>
        </div>
        <div className="relative flex flex-1 items-end justify-center gap-2 pb-2">
          {CREW.map((m, i) => (
            <span key={m.color} className="float inline-flex" style={{ ["--d" as string]: `${-i * 1.4}s`, marginBottom: compact ? m.lift * 0.7 : m.lift }}>
              <Mascot color={m.color} size={compact ? Math.round(m.size * 0.8) : m.size} state={m.state} />
            </span>
          ))}
        </div>
        <figcaption className="relative flex items-center gap-2 text-13 text-ink-2">
          <span className="live-dot text-good" data-live aria-hidden />
          Still working.
        </figcaption>
      </div>
    </figure>
  );
}
