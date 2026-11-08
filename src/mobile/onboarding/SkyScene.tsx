import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { MausAvatar, type MausAvatarHandle } from "@/components/Avatar";
import type { MausColor } from "@/lib/mascot";
import type { GrokBodyId } from "../../../shared/grok-bodies";
import { haptic } from "../haptics";
import { spring } from "../motion";
import "./onboarding.css";

export type SkyStage = "intro0" | "intro1" | "intro2" | "link" | "form" | "scan" | "success";

type Spot = { x: number; y: number; s: number; o?: number; r?: number };

interface Cast {
  id: string;
  color: MausColor;
  body: GrokBodyId;
  /** How far it drifts with a page swipe: near ones move more. */
  depth: number;
  float: number;
  spots: Record<SkyStage, Spot>;
}

/** Positions are the mascot's centre in % of the screen; `s` scales an 84px mascot. */
const CAST: Cast[] = [
  { id: "a", color: "blue", body: "blob", depth: 0.42, float: 6.2, spots: {
    intro0: { x: 50, y: 30, s: 1.55 }, intro1: { x: 31, y: 27, s: 0.72, r: -6 }, intro2: { x: 30, y: 28, s: 1.05 },
    form: { x: 36, y: 2.5, s: 0.5, r: 180 }, link: { x: 16, y: 14, s: 0.62 }, scan: { x: 50, y: 18, s: 0.5, o: 0 }, success: { x: -30, y: 20, s: 0.8, o: 0 } } },
  { id: "b", color: "orange", body: "flower", depth: 0.3, float: 7.4, spots: {
    intro0: { x: 22, y: 20, s: 0.95, r: -8 }, intro1: { x: 69, y: 27, s: 0.72, r: 6 }, intro2: { x: 74, y: 20, s: 0.9, r: 6 },
    form: { x: 88, y: 2.5, s: 0.46, r: 172 }, link: { x: 84, y: 12, s: 0.55 }, scan: { x: 84, y: 10, s: 0.4, o: 0 }, success: { x: 130, y: 10, s: 0.8, o: 0 } } },
  { id: "c", color: "green", body: "bean", depth: 0.55, float: 5.6, spots: {
    intro0: { x: 80, y: 22, s: 1.05, r: 8 }, intro1: { x: 22, y: 50, s: 0.66 }, intro2: { x: 58, y: 40, s: 0.85 },
    form: { x: 62, y: 2, s: 0.44, r: 186 }, link: { x: 38, y: 9, s: 0.5 }, scan: { x: 38, y: 8, s: 0.4, o: 0 }, success: { x: 40, y: -30, s: 0.8, o: 0 } } },
  { id: "d", color: "pink", body: "heart", depth: 0.25, float: 8.1, spots: {
    intro0: { x: 18, y: 42, s: 0.8, r: 10 }, intro1: { x: 78, y: 50, s: 0.58, r: 8 }, intro2: { x: 16, y: 46, s: 0.7, r: -8 },
    form: { x: 75, y: 3, s: 0.4, r: 176 }, link: { x: 64, y: 10, s: 0.48 }, scan: { x: 64, y: 8, s: 0.4, o: 0 }, success: { x: -30, y: 60, s: 0.8, o: 0 } } },
  { id: "e", color: "teal", body: "cloud", depth: 0.36, float: 6.8, spots: {
    intro0: { x: 82, y: 44, s: 0.9, r: -6 }, intro1: { x: 50, y: 45, s: 0.9 }, intro2: { x: 84, y: 50, s: 0.8 },
    form: { x: 49, y: 3, s: 0.42, r: 184 }, link: { x: 92, y: 24, s: 0.46 }, scan: { x: 92, y: 20, s: 0.4, o: 0 }, success: { x: 130, y: 60, s: 0.8, o: 0 } } },
  { id: "f", color: "yellow", body: "star", depth: 0.18, float: 9.2, spots: {
    intro0: { x: 54, y: 10, s: 0.6, r: 12 }, intro1: { x: 32, y: 8, s: 0.42, r: -10 }, intro2: { x: 46, y: 12, s: 0.5, r: 14 },
    form: { x: 97, y: 12, s: 0.4, o: 0 }, link: { x: 8, y: 26, s: 0.42 }, scan: { x: 8, y: 22, s: 0.4, o: 0 }, success: { x: 50, y: -30, s: 0.6, o: 0 } } },
  { id: "g", color: "purple", body: "pebble", depth: 0.48, float: 7.0, spots: {
    intro0: { x: 46, y: 50, s: 0.7, r: -4 }, intro1: { x: 66, y: 8, s: 0.5 }, intro2: { x: 40, y: 52, s: 0.6, r: 8 },
    form: { x: 100, y: 12, s: 0.4, o: 0 }, link: { x: 50, y: 22, s: 0.7 }, scan: { x: 50, y: 30, s: 0.6, o: 0 }, success: { x: 50, y: 120, s: 0.8, o: 0 } } },
];

/** Deterministic, so the sky is the same on every launch and between renders. */
function stars(count: number) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => ({ id: i, x: rand() * 100, y: rand() * 72, size: rand() > 0.85 ? 2.5 : rand() > 0.5 ? 1.6 : 1.1, delay: rand() * 6, period: 3 + rand() * 4, base: 0.25 + rand() * 0.5 }));
}

export function useScreen(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** `margin`: how far a mascot keeps off it; top-bar controls ask for more room than content. */
export type ClearRect = { left: number; top: number; right: number; bottom: number; margin?: number };
const CLEAR_MARGIN = 14;
const BAR_MARGIN = 36;

/** Where a mascot of `radius` centred at (x, y) lands so it stays out of every rect the screen asked to keep clear: it
 * leaves the first rect it overlaps by the shortest way out, and it may hang off the screen edge, never onto content. */
export function keepClear(x: number, y: number, radius: number, rects: readonly ClearRect[], w: number, h: number): { x: number; y: number } {
  let px = x, py = y;
  for (let pass = 0; pass < 3; pass++) {
    const hit = rects.find((r) => { const m = r.margin ?? CLEAR_MARGIN; return px + radius > r.left - m && px - radius < r.right + m && py + radius > r.top - m && py - radius < r.bottom + m; });
    if (!hit) break;
    const m = hit.margin ?? CLEAR_MARGIN;
    const exits = [
      { x: hit.left - m - radius, y: py },
      { x: hit.right + m + radius, y: py },
      { x: px, y: hit.top - m - radius },
      { x: px, y: hit.bottom + m + radius },
    ].filter((p) => p.x > -radius * 0.6 && p.x < w + radius * 0.6 && p.y > -radius * 0.6 && p.y < h + radius * 0.6);
    if (!exits.length) break;
    const best = exits.reduce((a, b) => (Math.hypot(a.x - px, a.y - py) <= Math.hypot(b.x - px, b.y - py) ? a : b));
    px = best.x; py = best.y;
  }
  return { x: px, y: py };
}

/** The rects of everything on screen marked `data-sky-clear`, measured after the step has laid out and again once its
 * entrance has settled. */
function useClearRects(root: HTMLElement | null, key: string): ClearRect[] {
  const [rects, setRects] = useState<ClearRect[]>([]);
  useEffect(() => {
    if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      setRects([...root.ownerDocument.querySelectorAll<HTMLElement>("[data-sky-clear]")]
        .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
        .map((el) => { const r = el.getBoundingClientRect(); return { left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top, ...(el.dataset.skyClear === "bar" ? { margin: BAR_MARGIN } : {}) }; })
        .filter((r) => r.right > r.left && r.bottom > r.top));
    };
    const first = requestAnimationFrame(measure);
    const settled = window.setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(first); window.clearTimeout(settled); window.removeEventListener("resize", measure); };
  }, [root, key]);
  return rects;
}

const Mascot = memo(function Mascot({ cast, stage, drag, working, w, h, clear }: { cast: Cast; stage: SkyStage; drag?: MotionValue<number>; working: boolean; w: number; h: number; clear: readonly ClearRect[] }) {
  const ref = useRef<MausAvatarHandle>(null);
  const reduced = useReducedMotion();
  const spot = cast.spots[stage];
  const zero = useMotionValue(0);
  const parallax = useTransform(drag ?? zero, (v) => (reduced ? 0 : v * cast.depth));
  const placed = keepClear((spot.x / 100) * w, (spot.y / 100) * h, 42 * spot.s, clear, w, h);
  return (
    <motion.div className="absolute left-0 top-0" style={{ x: parallax }}>
      <motion.button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="absolute left-[-42px] top-[-42px] size-[84px] touch-manipulation"
        initial={false}
        animate={{ ...placed, scale: spot.s, rotate: spot.r ?? 0, opacity: spot.o ?? 1 }}
        transition={{ ...spring.panel, opacity: { duration: 0.22 } }}
        whileTap={{ scale: spot.s * 1.14, transition: spring.lively }}
        onPointerDown={() => { haptic("light"); ref.current?.poke?.(); }}
      >
        <span className="omb-float block size-full" style={{ animationDuration: `${cast.float}s` }}>
          <MausAvatar ref={ref} color={cast.color} bodyId={cast.body} size={84} state={working ? "working" : "idle"} trackPointer label="" />
        </span>
      </motion.button>
    </motion.div>
  );
});

/** The onboarding's one continuous scene: a night sky the mascots live in. Every step of onboarding plays in front of it,
 * and the mascots regroup for each step instead of the screen cutting. */
export function SkyScene({ stage, drag, children, glyphs, clearKey = "" }: { stage: SkyStage; drag?: MotionValue<number>; children?: ReactNode; glyphs?: ReactNode; /** changes when the screen in front changes, so the keep-clear zones are measured again */ clearKey?: string }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const clear = useClearRects(root, `${stage}:${clearKey}`);
  const field = useMemo(() => stars(52), []);
  const { w, h } = useScreen();
  return (
    <div ref={setRoot} className="omb-sky absolute inset-0 overflow-hidden" data-scan-clear>
      <div aria-hidden className="absolute inset-0" data-scan-hide style={{ background: "linear-gradient(180deg, #0a0c13 0%, #111626 52%, #1a2036 100%)" }} />
      <div aria-hidden className="absolute -right-24 -top-24 size-[340px] rounded-full" data-scan-hide style={{ background: "radial-gradient(closest-side, rgb(255 244 222 / 0.10), transparent)" }} />
      <div aria-hidden className="absolute inset-0" data-scan-hide>
        {field.map((star) => (
          <span key={star.id} className="omb-twinkle absolute rounded-full bg-white"
            style={{ left: `${star.x}%`, top: `${star.y}%`, width: star.size, height: star.size, opacity: star.base, animationDelay: `${star.delay}s`, animationDuration: `${star.period}s` }} />
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0" data-scan-hide>
        <span className="omb-cloud absolute left-[-30%] top-[58%] h-[180px] w-[150%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(255 255 255 / 0.07), transparent)", animationDuration: "48s" }} />
        <span className="omb-cloud absolute left-[-10%] top-[70%] h-[220px] w-[120%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(160 180 255 / 0.06), transparent)", animationDuration: "64s", animationDirection: "alternate-reverse" }} />
        <span className="omb-cloud absolute left-[20%] top-[8%] h-[120px] w-[90%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(255 255 255 / 0.04), transparent)", animationDuration: "56s" }} />
      </div>
      {glyphs}
      <div className="absolute inset-0" data-scan-hide>
        {CAST.map((cast) => <Mascot key={cast.id} cast={cast} stage={stage} drag={drag} w={w} h={h} clear={clear} working={stage === "intro2" && (cast.id === "a" || cast.id === "e")} />)}
      </div>
      {children}
    </div>
  );
}
