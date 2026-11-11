import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import cloud from "../art/cloud-pink.png";
import meadow from "../art/scene-meadow.webp";
import meadowBand from "../art/scene-meadow-band.webp";
import computer from "../art/s-computer.webp";
import phone from "../art/s-phone.webp";
import sky from "../art/scene-sky.webp";
import skyBand from "../art/scene-sky-band.webp";
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

const MOOD: Record<SceneMood, BotState> = { idle: "idle", typing: "listening", thinking: "thinking", waiting: "curious", oops: "confused", party: "celebrate" };
const SPARKS = Object.values(BOT_COLOURS).slice(0, 6);

// the meadow art in blocks: its size, and the hilltop kit stands on
const GROUND = {
  wide: { src: meadow, w: 120, h: 40, x: 74, top: 6 },
  band: { src: meadowBand, w: 96, h: 16, x: 78, top: 3 },
};

interface Friend { body: string; colour: BotColour; x: number; y: number }
// floating up in the sky, in percent of the scene
const FRIENDS: Record<"top" | "low" | "band", Friend[]> = {
  top: [{ body: "wisp", colour: "purple", x: 64, y: 13 }, { body: "mochi", colour: "pink", x: 76, y: 10.5 }, { body: "loaf", colour: "orange", x: 88, y: 13.5 }],
  low: [{ body: "wisp", colour: "purple", x: 14, y: 68 }, { body: "mochi", colour: "pink", x: 26, y: 65.5 }, { body: "loaf", colour: "orange", x: 38, y: 68.5 }],
  band: [{ body: "wisp", colour: "purple", x: 9, y: 16 }, { body: "mochi", colour: "pink", x: 19, y: 11 }, { body: "loaf", colour: "orange", x: 29, y: 17 }],
};

const STEP_STATE: BotState[] = ["happy", "curious", "happy"];

export interface SceneHandle { react(kind: BotReaction, which?: number): void }

/** a banded pixel sky over a lime meadow: kit stands on the hill, a few friends float above. `step` swaps what kit says in its bubble.
 * the art is decoration; nothing here is needed to use the page */
export const Scene = forwardRef<SceneHandle, { mood?: SceneMood; step?: number; look?: { x: number; y: number } | null; compact?: boolean; friends?: "top" | "low"; className?: string; children?: ReactNode }>(
  function Scene({ mood = "idle", step, look = null, compact = false, friends = "top", className, children }, ref) {
    const reduced = useReducedMotion();
    const bots = useRef<Array<MascotHandle | null>>([]);
    const ground = compact ? GROUND.band : GROUND.wide;
    const crew = FRIENDS[compact ? "band" : friends];
    const [shown, setShown] = useState(false);
    const [sparks, setSparks] = useState<Array<{ id: number; dx: number; dy: number; colour: string }>>([]);
    useImperativeHandle(ref, () => ({
      react(kind, which) {
        if (which === undefined) bots.current.forEach((b) => b?.react(kind));
        else bots.current[which % bots.current.length]?.react(kind);
      },
    }), []);
    // the first bubble waits for the crew to pop in, so it arrives by transition
    useEffect(() => { const t = setTimeout(() => setShown(true), reduced ? 0 : 900); return () => clearTimeout(t); }, [reduced]);
    useEffect(() => {
      if (!shown || step !== 0) return;
      const t = setTimeout(() => bots.current[0]?.react("greet"), 260);
      return () => clearTimeout(t);
    }, [shown, step]);
    useEffect(() => {
      if (mood !== "party" || reduced) return;
      let id = 0;
      const burst = () => setSparks(Array.from({ length: 12 }, () => ({ id: id++, dx: (Math.random() - 0.5) * 180, dy: -50 - Math.random() * 120, colour: SPARKS[Math.floor(Math.random() * SPARKS.length)]! })));
      burst();
      const again = setInterval(burst, 1500);
      return () => { clearInterval(again); setSparks([]); };
    }, [mood, reduced]);
    const kit = compact ? 52 : 96;
    const friend = compact ? 26 : 44;
    const state = mood === "idle" && step !== undefined ? STEP_STATE[step] ?? "idle" : MOOD[mood];
    const gaze = look ?? (mood === "idle" && step !== undefined && step > 0 ? { x: -0.6, y: -0.7 } : null);
    return (
      <div className={cx("relative isolate overflow-hidden bg-[#3cd0fd]", className)} aria-hidden>
        <img src={compact ? skyBand : sky} alt="" className="pixel-art absolute inset-0 size-full object-cover object-bottom" draggable={false} />
        {crew.map((m, i) => (
          <span key={m.body} className="peek absolute -translate-x-1/2" style={{ left: `${m.x}%`, top: `${m.y}%`, ["--i" as string]: i + 1 }}>
            <Mascot ref={(h) => { bots.current[i + 1] = h; }} body={m.body} color={m.colour} size={friend} state={MOOD[mood]} track={look ? false : 1600} gaze={look} tappable />
          </span>
        ))}
        {children}
        <div className="absolute inset-x-0 bottom-0" style={{ aspectRatio: `${ground.w} / ${ground.h}` }}>
          <img src={ground.src} alt="" className="pixel-art absolute inset-0 size-full" draggable={false} />
          <span className="absolute -translate-x-1/2" style={{ left: `${ground.x}%`, bottom: `calc(${((ground.h - ground.top) / ground.h) * 100}% - ${Math.round(kit * 0.08)}px)`, width: kit, height: kit }}>
            <span className="absolute bottom-[104%] right-[62%]">
              <Say on={shown && step === 0} tint="var(--scene-pink)" compact={compact}><span className={cx("font-pixel font-medium leading-none text-[#212121]", compact ? "text-[15px]" : "text-[26px]")}>hi!</span></Say>
              <Say on={shown && step === 1} tint="var(--scene-lemon)" compact={compact}>
                <span className={cx("px-steps flex bg-[#3cd0fd]", compact ? "px-1.5 py-1" : "px-2.5 py-2")}><img src={cloud} alt="" width={240} height={80} className={cx("pixel-art", compact ? "w-[40px]" : "w-[72px]")} draggable={false} /></span>
              </Say>
              <Say on={shown && step === 2} tint="var(--scene-lilac)" compact={compact}>
                <span className={cx("flex items-end", compact ? "gap-1.5" : "gap-3")}>
                  <img src={computer} alt="" width={520} height={599} className={compact ? "w-[22px]" : "w-[40px]"} draggable={false} />
                  <img src={phone} alt="" width={520} height={387} className={compact ? "w-[26px]" : "w-[48px]"} draggable={false} />
                </span>
              </Say>
            </span>
            <span className="peek absolute inset-0" style={{ ["--i" as string]: 0 }}>
              <Mascot ref={(h) => { bots.current[0] = h; }} body="kit" color="blue" size={kit} state={state} track={gaze ? false : 2400} gaze={gaze} tappable />
            </span>
            {sparks.map((s) => <i key={s.id} className="spark z-20" style={{ left: "50%", bottom: "60%", background: s.colour, ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px` }} />)}
          </span>
        </div>
      </div>
    );
  },
);

/** a pixel chat bubble: white body with stepped corners, a tinted underside, a stepped tail down toward kit */
function Say({ on, tint, compact, children }: { on: boolean; tint: string; compact: boolean; children: ReactNode }) {
  return (
    <span className={cx("say absolute bottom-0 right-0", compact && "say-sm")} data-on={on || undefined} style={{ ["--u" as string]: tint }}>
      <span className={cx("say-body px-steps flex items-center justify-center", compact ? "h-[36px] min-w-[52px] px-3" : "h-[66px] min-w-[96px] px-5")}>{children}</span>
      <span className="say-tail" />
    </span>
  );
}
