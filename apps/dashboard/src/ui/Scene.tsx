import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import cloudLemon from "../art/cloud-lemon.png";
import cloudPink from "../art/cloud-pink.png";
import { cx } from "./kit";
import { BOT_COLOURS, Mascot, useReducedMotion, type BotColour, type BotReaction, type BotState, type MascotHandle } from "./Mascot";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => { const m = window.matchMedia(query); m.addEventListener("change", fn); return () => m.removeEventListener("change", fn); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** what the scene is doing: the crew acts it out */
export type SceneMood = "idle" | "typing" | "thinking" | "waiting" | "oops" | "party";

interface Member { body: string; colour: BotColour; size: number; x: number; y: number; sleepy?: boolean; wide?: boolean }

// placed in percent of the scene, standing on the poster's meadow; the back row is smaller and higher
const CREW: Member[] = [
  { body: "cloud", colour: "orange", size: 76, x: 12, y: 9.5, wide: true },
  { body: "circle", colour: "blue", size: 104, x: 28, y: 3.5 },
  { body: "star", colour: "yellow", size: 72, x: 46, y: 10 },
  { body: "heart", colour: "pink", size: 92, x: 62, y: 3 },
  { body: "hex", colour: "red", size: 76, x: 78, y: 9.5, wide: true },
  { body: "moon", colour: "purple", size: 64, x: 91, y: 2.5, sleepy: true, wide: true },
];

const SMALL_CREW = CREW.filter((m) => !m.wide);

const MOOD: Record<SceneMood, BotState> = { idle: "idle", typing: "listening", thinking: "thinking", waiting: "curious", oops: "confused", party: "celebrate" };
const SPARKS = Object.values(BOT_COLOURS).slice(0, 6);

export interface SceneHandle { react(kind: BotReaction, which?: number): void }

/** a poster with a few bots living in it: they watch the pointer, turn to `look` when something is happening elsewhere,
 * and act out `mood`. the art is decoration; nothing here is needed to use the page */
export const Scene = forwardRef<SceneHandle, { poster: string; mood?: SceneMood; look?: { x: number; y: number } | null; compact?: boolean; className?: string; children?: ReactNode }>(
  function Scene({ poster, mood = "idle", look = null, compact = false, className, children }, ref) {
    const reduced = useReducedMotion();
    const bots = useRef<Array<MascotHandle | null>>([]);
    const crew = compact ? SMALL_CREW : CREW;
    const [sparks, setSparks] = useState<Array<{ id: number; x: number; y: number; dx: number; dy: number; colour: string }>>([]);
    useImperativeHandle(ref, () => ({
      react(kind, which) {
        if (which === undefined) bots.current.forEach((b) => b?.react(kind));
        else bots.current[which % crew.length]?.react(kind);
      },
    }), [crew.length]);
    useEffect(() => {
      if (mood !== "party" || reduced) return;
      let id = 0;
      const burst = () => setSparks(crew.flatMap((m) => Array.from({ length: 4 }, () => ({ id: id++, x: m.x, y: m.y + 8, dx: (Math.random() - 0.5) * 150, dy: -40 - Math.random() * 110, colour: SPARKS[Math.floor(Math.random() * SPARKS.length)]! }))));
      burst();
      const again = setInterval(burst, 1500);
      return () => { clearInterval(again); setSparks([]); };
    }, [mood, reduced, crew]);
    const scale = compact ? 0.56 : 1;
    return (
      <div className={cx("relative isolate overflow-hidden bg-[#3fbdfb]", className)} aria-hidden>
        <img src={poster} alt="" className="absolute inset-0 size-full object-cover object-bottom" draggable={false} />
        <img src={cloudPink} alt="" width={240} height={80} className="pixel-art cloud-drift absolute left-[6%] top-[7%] w-[19%] max-w-[150px]" style={{ ["--drift" as string]: "90px", ["--dur" as string]: "38s" }} draggable={false} />
        <img src={cloudLemon} alt="" width={240} height={80} className="pixel-art cloud-drift absolute right-[10%] top-[19%] w-[13%] max-w-[104px] max-lg:top-[30%]" style={{ ["--drift" as string]: "-70px", ["--dur" as string]: "52s" }} draggable={false} />
        {children}
        {crew.map((m, i) => {
          const asleep = m.sleepy && mood === "idle";
          return (
            <span key={m.body} className="peek absolute z-10 -translate-x-1/2" style={{ left: `${m.x}%`, bottom: `${compact ? m.y * 0.5 : m.y}%`, ["--i" as string]: i }}>
              <Mascot ref={(h) => { bots.current[i] = h; }} body={m.body} color={m.colour} size={Math.round(m.size * scale)} state={asleep ? "sleeping" : m.sleepy && mood === "typing" ? "waking" : MOOD[mood]} track={asleep || look ? false : 2400} gaze={asleep ? null : look} tappable />
              {asleep && !reduced && <span className="absolute -right-1 -top-2"><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i><i className="zz not-italic !text-white">z</i></span>}
            </span>
          );
        })}
        {sparks.map((s) => <i key={s.id} className="spark z-20" style={{ left: `${s.x}%`, bottom: `${s.y}%`, background: s.colour, ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px` }} />)}
      </div>
    );
  },
);
