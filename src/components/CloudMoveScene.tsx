import { motion } from "motion/react";
import type { MausColor } from "@/lib/mascot";
import { botsAcross } from "@/lib/cloud-move-offer";
import { MausAvatar } from "./Avatar";
import { useMotionReduced } from "./ui/SheetMotion";

const CELL = 4;
const W = 320, H = 132;
const BOTS: MausColor[] = ["orange", "blue", "green"];
const BOT = 26;
const LAPTOP = { x: 24, y: 68, cols: 22, rows: 13 };
const CLOUD = { x: 200, y: 62, cols: 24, rows: 12 };
/** Where each bot stands: its centre, and the line its feet are on. */
const ON_LAPTOP = [{ x: 42, y: 70 }, { x: 68, y: 70 }, { x: 94, y: 70 }];
const ON_CLOUD = [{ x: 222, y: 76 }, { x: 248, y: 72 }, { x: 274, y: 76 }];
const HOP_MS = 720;

type Px = { x: number; y: number; tone: string };

function laptopPixels(): Px[] {
  const out: Px[] = [];
  for (let y = 0; y <= 10; y++) for (let x = 2; x <= 19; x++) {
    const frame = y === 0 || y === 10 || x === 2 || x === 19;
    out.push({ x, y, tone: frame ? "frame" : y <= 2 && x <= 6 ? "glow" : "screen" });
  }
  for (let x = 0; x <= 21; x++) out.push({ x, y: 11, tone: x >= 9 && x <= 12 ? "notch" : "frame" });
  for (let x = 1; x <= 20; x++) out.push({ x, y: 12, tone: "base" });
  return out;
}

function cloudPixels(): Px[] {
  const puffs = [[6, 7, 4.2], [12, 5, 5.6], [18.5, 7, 4.4]] as const;
  const inside = (x: number, y: number) => y >= 0 && x >= 0 && x < CLOUD.cols && y < CLOUD.rows
    && ((y >= 7 && y <= 10 && x >= 2 && x <= 21) || puffs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r));
  const out: Px[] = [];
  for (let y = 0; y < CLOUD.rows; y++) for (let x = 0; x < CLOUD.cols; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x, y + 1) || !inside(x + 1, y);
    const top = !inside(x, y - 1) || !inside(x - 1, y);
    out.push({ x, y, tone: edge ? "shade" : top ? "light" : "body" });
  }
  return out;
}

const LAPTOP_PX = laptopPixels(), CLOUD_PX = cloudPixels();
const FILL: Record<string, string> = {
  frame: "color-mix(in oklch, var(--color-ink) 34%, var(--color-menu))",
  base: "color-mix(in oklch, var(--color-ink) 24%, var(--color-menu))",
  notch: "color-mix(in oklch, var(--color-ink) 46%, var(--color-menu))",
  screen: "color-mix(in oklch, var(--identity-blue) 14%, var(--color-menu))",
  glow: "color-mix(in oklch, var(--identity-blue) 30%, var(--color-menu))",
  // the cloud is the same off-white in every skin, so it reads as a cloud on a dark sheet and a light one
  body: "#e6edf7",
  light: "#f5f8fc",
  shade: "#aebfdc",
};

function Pixels({ at, pixels }: { at: { x: number; y: number }; pixels: Px[] }) {
  return <g transform={`translate(${at.x} ${at.y})`}>
    {pixels.map((px) => <rect key={`${px.x}-${px.y}`} x={px.x * CELL} y={px.y * CELL} width={CELL} height={CELL} fill={FILL[px.tone]} />)}
  </g>;
}

const spot = (slot: { x: number; y: number }) => `translate(${slot.x - BOT / 2}px, ${slot.y - BOT}px)`;

/** Bots hopping from this computer onto dusk cloud: `progress` 0 to 1, the last bot hops only once everything arrived. */
export function CloudMoveScene({ progress, done = false }: { progress: number; done?: boolean }) {
  const reduced = useMotionReduced();
  const across = botsAcross(done ? 1 : progress, BOTS.length);
  return <div aria-hidden="true" data-cloud-move-scene={across} className="relative mx-auto h-[132px] w-[320px] max-w-full overflow-hidden">
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="absolute inset-0">
      <Pixels at={LAPTOP} pixels={LAPTOP_PX} />
      <Pixels at={CLOUD} pixels={CLOUD_PX} />
    </svg>
    {BOTS.map((color, index) => {
      const there = index < across, from = ON_LAPTOP[index]!, to = ON_CLOUD[index]!;
      const at = there ? to : from;
      const peak = `translate(${(from.x + to.x) / 2 - BOT / 2}px, ${Math.min(from.y, to.y) - BOT - 44}px)`;
      const bot = <MausAvatar color={color} size={BOT} state={done ? "celebrate" : "idle"} trackPointer={false} animated={!reduced} label="" />;
      if (reduced) {
        return <motion.span key={`${index}-${there}`} data-bot-at={there ? "cloud" : "laptop"} className="absolute left-0 top-0 block"
          style={{ transform: spot(at) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "easeOut" }}>{bot}</motion.span>;
      }
      return <motion.span key={index} data-bot-at={there ? "cloud" : "laptop"} className="absolute left-0 top-0 block will-change-transform"
        initial={false}
        animate={{ transform: there ? [spot(from), peak, spot(to)] : spot(from) }}
        transition={{ duration: HOP_MS / 1000, ease: "easeInOut", times: [0, 0.45, 1], delay: there ? 0.16 * index : 0 }}>{bot}</motion.span>;
    })}
  </div>;
}
