import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MausColor } from "../../../shared/wire";
import { cx } from "./kit";
import { Mascot } from "./Mascot";
import { Stars } from "./Sky";

const W = 520;
const H = 340;

const CREW: Array<{ color: MausColor; state: "working" | "coding" | "searching"; size: number; x: number; y: number; d: number }> = [
  { color: "blue", state: "working", size: 54, x: 206, y: 158, d: 0 },
  { color: "orange", state: "searching", size: 34, x: 323, y: 92, d: -1.6 },
  { color: "green", state: "coding", size: 42, x: 408, y: 170, d: -0.8 },
];

// the screen's code lines: x offset, width, delay
const LINES: Array<[number, number, number]> = [[0, 58, 0], [10, 44, 0.5], [10, 66, 1.0], [0, 36, 1.5], [10, 52, 2.0]];

/** the pitch as one picture: a cloud computer with its crew at work under a night sky, and far off, a Mac asleep */
export function NightScene({ className, time = "3:12 AM" }: { className?: string; time?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const uid = useId().replace(/:/g, "");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1.15, el.clientWidth / W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <figure ref={box} className={cx("relative w-full overflow-hidden", className)} style={{ height: H * scale }} aria-label={`At ${time} your Mac is asleep and its bots with it. On a cloud desktop your bots are still working.`}>
      <Stars count={54} seed={31} className="[mask-image:radial-gradient(ellipse_at_70%_30%,black_30%,transparent_80%)]" />
      <div className="absolute left-1/2 top-0 origin-top" style={{ width: W, height: H, transform: `translateX(-50%) scale(${scale})` }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0" aria-hidden>
          <defs>
            <mask id={`moon-${uid}`}><rect width={W} height={H} fill="white" /><circle cx={476} cy={46} r={13} fill="black" /></mask>
            <linearGradient id={`cloud-${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="160" x2="0" y2="256">
              <stop offset="0" style={{ stopColor: "color-mix(in oklab, var(--ink) 14%, var(--card))" }} />
              <stop offset="1" style={{ stopColor: "color-mix(in oklab, var(--ink) 5%, var(--card))" }} />
            </linearGradient>
            <linearGradient id={`hill-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
              <stop offset="0.25" style={{ stopColor: "var(--ink)", stopOpacity: 0.035 }} />
              <stop offset="0.7" style={{ stopColor: "var(--ink)", stopOpacity: 0.025 }} />
              <stop offset="1" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {/* moon */}
          <circle cx={468} cy={52} r={15} opacity={0.78} mask={`url(#moon-${uid})`} style={{ fill: "var(--ink)" }} />
          {/* a low hill the Mac rests on */}
          <path d={`M0 ${H} L0 304 C 90 290, 170 292, 250 306 C 330 320, 430 316, ${W} 300 L ${W} ${H} Z`} fill={`url(#hill-${uid})`} />
          {/* the cloud the computer sits on */}
          <g fill={`url(#cloud-${uid})`}>
            <circle cx={262} cy={226} r={30} />
            <circle cx={300} cy={208} r={40} />
            <circle cx={352} cy={202} r={46} />
            <circle cx={404} cy={214} r={36} />
            <circle cx={438} cy={230} r={24} />
            <rect x={238} y={216} width={222} height={38} rx={19} />
          </g>
          {/* monitor */}
          <rect x={290} y={116} width={120} height={80} rx={10} style={{ fill: "var(--bg)", stroke: "color-mix(in oklab, var(--ink) 18%, transparent)" }} />
          <rect x={342} y={196} width={16} height={12} style={{ fill: "color-mix(in oklab, var(--ink) 16%, var(--card))" }} />
          <rect x={326} y={206} width={48} height={5} rx={2.5} style={{ fill: "color-mix(in oklab, var(--ink) 22%, var(--card))" }} />
          {/* the Mac: a closed laptop, side on */}
          <rect x={44} y={284} width={116} height={7} rx={3.5} style={{ fill: "color-mix(in oklab, var(--ink) 16%, var(--card))" }} />
          <rect x={50} y={278} width={104} height={6} rx={3} style={{ fill: "color-mix(in oklab, var(--ink) 24%, var(--card))" }} />
        </svg>
        {/* the code being written on the cloud computer's screen */}
        <div className="absolute flex flex-col gap-[7px]" style={{ left: 304, top: 132 }} aria-hidden>
          {LINES.map(([x, w, d], i) => (
            <span key={i} className="type-line block h-[5px] rounded-full" style={{ marginLeft: x, width: w, background: i === 2 ? "color-mix(in oklab, var(--accent) 70%, transparent)" : "color-mix(in oklab, var(--ink) 34%, transparent)", ["--d" as string]: `${d}s` }} />
          ))}
        </div>
        {CREW.map((m) => (
          <span key={m.color} className="float absolute" style={{ left: m.x, top: m.y, ["--d" as string]: `${m.d}s` }}>
            <Mascot color={m.color} size={m.size} state={m.state} />
          </span>
        ))}
        <span className="absolute" style={{ left: 80, top: 240 }}><Mascot color="silver" size={40} state="sleeping" /></span>
        {[0, 1.2, 2.4].map((d, i) => (
          <span key={i} className="zz absolute select-none text-12 font-medium text-ink-4" style={{ left: 124 + i * 6, top: 236 - i * 8, fontSize: 11 + i * 2, ["--d" as string]: `${d}s` }} aria-hidden>z</span>
        ))}
        <figcaption className="absolute flex items-center gap-2 whitespace-nowrap text-12 text-ink-2" style={{ left: 286, top: 268 }}>
          <span className="live-dot text-good" data-live aria-hidden />
          Still working, {time}
        </figcaption>
        <span className="absolute whitespace-nowrap text-12 text-ink-4" style={{ left: 50, top: 300 }} aria-hidden>Your Mac, asleep</span>
      </div>
    </figure>
  );
}
