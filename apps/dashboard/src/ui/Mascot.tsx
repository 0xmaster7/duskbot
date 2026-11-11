import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { BotReport } from "../../../../shared/dashboard-protocol";
import { botMood, type BotMood } from "../data/mood";
import { botSvg, bodyName, create, pointerGaze, type BodyName, type Bot, type BotReaction, type BotState } from "../mascot/index.js";
import { cx } from "./kit";

export type { BotReaction, BotState } from "../mascot/index.js";

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const useReducedMotion = () =>
  useSyncExternalStore((fn) => { query?.addEventListener("change", fn); return () => query?.removeEventListener("change", fn); }, () => query?.matches ?? false, () => false);

/** the brand's bot colours (the site's palette); every colour a bot was ever saved with has one */
export const BOT_COLOURS = {
  blue: "#2f7bf2", orange: "#ff7d1f", purple: "#8d5cf0", pink: "#ff5c9d", green: "#1fb866", yellow: "#f8c623",
  red: "#ef4a41", teal: "#17b3a6", cyan: "#22b4e8", coral: "#ff7a5c", brown: "#a0683a", silver: "#9a9aa3", chrome: "#9a9aa3",
} as const;
export type BotColour = keyof typeof BOT_COLOURS;
export const colorOf = (c: string | null | undefined): BotColour => (c && Object.hasOwn(BOT_COLOURS, c) ? (c as BotColour) : "blue");

// every body id a bot may have been saved with, drawn as the nearest of the ten dusk bodies; stored data is untouched
const SAVED_BODY: Record<string, BodyName> = {
  cursor: "squircle", tablet: "squircle", blob: "circle", circle: "circle", fruit: "circle", egg: "circle", pebble: "circle",
  squircle: "squircle", square: "pixel", house: "pixel", shield: "squircle", dome: "squircle",
  capsule: "pill", cylinder: "pill", bean: "pill", arch: "pill",
  drop: "drop", teardrop: "drop", leaf: "drop", wedge: "drop",
  hexagon: "hex", hex: "hex", diamond: "hex", gem: "hex", crystal: "hex",
  star: "star", sparkle: "star", heart: "heart", cloud: "cloud", clover: "cloud", flower: "cloud",
  pumpkin: "circle", ghost: "cloud", witch: "drop", bat: "moon", cat: "squircle", skull: "pill", monster: "pixel", mummy: "pill", vampire: "moon", spider: "hex",
};
export const bodyOf = (b: string | null | undefined): BodyName => (b ? SAVED_BODY[b] ?? bodyName(b) : "squircle");

export interface MascotHandle { react(kind: BotReaction): void; lookAt(x: number | null, y?: number): void }

interface MascotProps {
  color?: BotColour | string;
  /** a dusk body, or any body id a bot was saved with */
  body?: string | null;
  size?: number;
  state?: BotState;
  label?: string;
  /** hold the rest pose: no breathing, no blinking */
  still?: boolean;
  /** watch the pointer from up to this many px away (true is 260) */
  track?: boolean | number;
  /** look this way (-1..1, x right, y down) instead of at the pointer */
  gaze?: { x: number; y: number } | null;
  /** taps play a reaction */
  tappable?: boolean;
  className?: string;
}

// one pointer listener for every watching bot on the page
const watchers = new Map<Element, { bot: Bot; reach: number }>();
let pointerOn = false, moveFrame = 0, px = 0, py = 0;
function onPointer(e: PointerEvent) {
  px = e.clientX; py = e.clientY;
  if (moveFrame) return;
  moveFrame = requestAnimationFrame(() => {
    moveFrame = 0;
    for (const [el, w] of watchers) {
      const gaze = pointerGaze(el.getBoundingClientRect(), px, py, w.reach);
      w.bot.lookAt(gaze ? gaze.x : null, gaze?.y);
    }
  });
}
function watch(el: Element, bot: Bot, reach: number) {
  watchers.set(el, { bot, reach });
  if (!pointerOn) { pointerOn = true; window.addEventListener("pointermove", onPointer, { passive: true }); }
  return () => {
    watchers.delete(el);
    if (!watchers.size && pointerOn) { pointerOn = false; window.removeEventListener("pointermove", onPointer); }
  };
}

/** a dusk bot (src/mascot): it breathes, blinks and looks about on one shared frame loop, stops off screen and rests under
 * reduced motion */
export const Mascot = forwardRef<MascotHandle, MascotProps>(function Mascot({ color = "blue", body, size = 28, state = "idle", label, still = false, track = false, gaze = null, tappable = false, className }, ref) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const bot = useRef<Bot | null>(null);
  const name = bodyOf(body);
  const fill = Object.hasOwn(BOT_COLOURS, color) ? BOT_COLOURS[color as BotColour] : color;
  const rest = useMemo(() => ({ __html: botSvg(name) }), [name]);
  const frozen = still || reduced;
  useLayoutEffect(() => {
    if (!svg.current) return;
    const made = create(svg.current, { body: name, size, reducedMotion: frozen ? true : undefined });
    bot.current = made;
    return () => { made.destroy(); bot.current = null; };
  }, [name, frozen, size]);
  useLayoutEffect(() => { bot.current?.setState(state); }, [state, name, frozen, size]);
  const gx = gaze?.x, gy = gaze?.y;
  useEffect(() => {
    const made = bot.current;
    if (frozen || !svg.current || !made) return;
    if (gx !== undefined) { made.lookAt(gx, gy); return () => made.lookAt(null); }
    if (track) return watch(svg.current, made, track === true ? 260 : track);
  }, [track, frozen, name, size, gx, gy]);
  useImperativeHandle(ref, () => ({ react: (kind) => bot.current?.react(kind), lookAt: (x, y) => bot.current?.lookAt(x, y) }), []);
  return (
    <svg
      ref={svg}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cx("mascot shrink-0 overflow-visible", className)}
      style={{ color: fill }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onPointerDown={tappable ? () => bot.current?.react("tap") : undefined}
      dangerouslySetInnerHTML={rest}
    />
  );
});

export function BotMascot({ bot, size = 28, mood, track = false, tappable = false }: { bot: Pick<BotReport, "color" | "body" | "busy" | "lastActiveAt">; size?: number; mood?: BotMood; track?: boolean | number; tappable?: boolean }) {
  return <Mascot color={colorOf(bot.color)} body={bot.body} size={size} state={mood ?? botMood(bot)} track={track} tappable={tappable} />;
}
