import { useMemo, type ReactNode } from "react";
import type { BotReport } from "../../../shared/dashboard-protocol";
import { BotMascot, Mascot } from "./Mascot";
import { cx } from "./kit";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** a sparse, still night sky; a few stars breathe */
export function Stars({ count = 46, seed = 7, className }: { count?: number; seed?: number; className?: string }) {
  const stars = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, (_, i) => ({ x: r() * 100, y: r() * 100, s: 0.6 + r() * r() * 1.3, o: 0.18 + r() * 0.5, t: 3 + r() * 5, d: -r() * 6, tw: i % 3 === 0 }));
  }, [count, seed]);
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {stars.map((st, i) => (
        <span
          key={i}
          className={cx("absolute rounded-full", st.tw && "twinkle")}
          style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s * 2, height: st.s * 2, background: "var(--star)", opacity: st.o, ["--o" as string]: st.o, ["--t" as string]: `${st.t}s`, ["--d" as string]: `${st.d}s` }}
        />
      ))}
    </div>
  );
}

/** the person's bots, floating under a strip of sky beside the welcome line */
export function Crew({ bots, className }: { bots: BotReport[]; className?: string }) {
  const crew = bots.slice(0, 5);
  if (!crew.length) return null;
  return (
    <div className={cx("relative flex h-[72px] items-end gap-3 px-2", className)} aria-label={`Your bots: ${crew.map((b) => b.name).join(", ")}`} role="img">
      <Stars count={22} seed={crew.length * 13 + 3} className="-inset-x-10 -top-6 [mask-image:radial-gradient(closest-side,black,transparent)]" />
      {crew.map((b, i) => (
        <span key={b.id} className="float relative" style={{ ["--d" as string]: `${-i * 1.1}s`, marginBottom: i % 2 ? 14 : 0 }}>
          <span className="peek inline-flex" style={{ ["--i" as string]: i }}>
            <BotMascot bot={b} size={i === 0 ? 40 : 32} still={false} />
          </span>
        </span>
      ))}
    </div>
  );
}

/** an empty state: one mascot looking up at the sky, a line, and the next step */
export function SkyEmpty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-card bg-card px-6 pb-10 pt-16 text-center", className)}>
      <Stars count={40} seed={21} className="[mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
      <div className="relative flex flex-col items-center">
        <span className="float"><Mascot color="blue" size={64} state="curious" track /></span>
        <h2 className="mt-5 text-16 font-medium text-ink">{title}</h2>
        {children && <div className="mt-1.5 max-w-[46ch] text-14 leading-[1.55] text-ink-3">{children}</div>}
        {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
