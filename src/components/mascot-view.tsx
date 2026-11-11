import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { createPixel, stillSvgPaths, type PixelBot, type PixelState } from "@/pixel/engine";
import { duskBody } from "../../shared/body-migration";
import { EXPRESSION_STATES, pixelReaction, pixelState, type MarkGaze, type MarkPoke, type MarkReaction } from "./mascot-engine";
import { onMascotCue } from "./mascot-events";
import { ATTENTION } from "./mascot-attention";

const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/** How long a mark keeps looking at the composer after the last keystroke. */
const WATCH_MS = 1400;
const COMPOSER_GAZE = { x: 0.15, y: 0.75 };

export interface DuskMarkProps {
  /** Any body id a bot was saved with; unknown ids wear the default. */
  body: string;
  /** CSS paint for the body. */
  colour: string;
  /** CSS paint for the eyes. */
  eyes?: string;
  state?: string;
  size?: number;
  /** False draws the state's eyes once and never moves. */
  animated?: boolean;
  /** A resting mark looks up, surprised, while the pointer is on it. */
  emphasized?: boolean;
  /** Where the mark looks, -1..1 on each axis with y down; null looks about on its own. */
  gaze?: MarkGaze | null;
  /** Index into the older expression list, held until it changes. */
  expression?: number;
  label?: string | null;
  /** False: no blinks or settling of its own between turns. */
  life?: boolean;
  /** The bot whose app moments (a message typed, a chat opened) this mark answers. */
  cueKey?: string;
  className?: string;
  style?: CSSProperties;
}

export interface DuskMarkHandle {
  blink: () => void;
  spin: (durationMs?: number) => void;
  setExpression: (index: number) => void;
  /** No kind plays a random tap reaction. */
  poke: (kind?: MarkPoke) => void;
  react: (kind: MarkReaction) => void;
}

const expressionState = (index: number) => EXPRESSION_STATES[((index % EXPRESSION_STATES.length) + EXPRESSION_STATES.length) % EXPRESSION_STATES.length]!;

export const DuskMark = forwardRef<DuskMarkHandle, DuskMarkProps>(function DuskMark(
  { body, colour, eyes, state = "idle", size = 44, animated = true, emphasized = false, gaze = null, expression, label, life = true, cueKey, className, style },
  ref,
) {
  const shape = duskBody(body);
  const el = useRef<HTMLSpanElement>(null);
  const bot = useRef<PixelBot | null>(null);
  const [held, setHeld] = useState<PixelState | null>(null);
  const shown: PixelState = held ?? (expression !== undefined ? expressionState(expression) : emphasized && pixelState(state) === "idle" ? "surprised" : pixelState(state));
  const latest = useRef({ colour, eyes, shown, life, gaze });
  latest.current = { colour, eyes, shown, life, gaze };
  const watching = useRef(false);
  const applyLook = () => bot.current?.look(watching.current ? COMPOSER_GAZE : latest.current.gaze);

  useClientLayoutEffect(() => {
    const p = latest.current;
    const made = createPixel(el.current!, {
      body: shape, size, colour: p.colour, eyes: p.eyes, state: p.shown, animated, life: p.life,
      follow: animated && p.life && size >= ATTENTION.minPx,
    });
    bot.current = made;
    applyLook();
    return () => { made.destroy(); bot.current = null; };
  }, [shape, size, animated]);

  useEffect(() => { bot.current?.setState(shown); }, [shown]);
  useEffect(() => { bot.current?.setColour(colour); }, [colour]);
  useEffect(() => { bot.current?.setEyes(eyes); }, [eyes]);
  useEffect(() => { bot.current?.setLife(life); }, [life]);
  useEffect(() => { applyLook(); }, [gaze?.x, gaze?.y, gaze === null]);

  useEffect(() => {
    if (!cueKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onMascotCue(cueKey, (cue) => {
      if (cue !== "watch") {
        const kind = pixelReaction(cue);
        if (kind) bot.current?.react(kind);
        return;
      }
      clearTimeout(timer);
      watching.current = true;
      applyLook();
      timer = setTimeout(() => { watching.current = false; applyLook(); }, WATCH_MS);
    });
    return () => { off(); clearTimeout(timer); watching.current = false; };
  }, [cueKey]);

  useImperativeHandle(ref, () => ({
    blink: () => bot.current?.blink(),
    spin: () => bot.current?.react("spin"),
    setExpression: (index: number) => setHeld(expressionState(index)),
    poke: (kind?: MarkPoke) => {
      const r = kind ? pixelReaction(kind) : null;
      if (r) bot.current?.react(r); else bot.current?.poke();
    },
    react: (kind: MarkReaction) => {
      const r = pixelReaction(kind);
      if (r === "poke") bot.current?.poke(); else if (r) bot.current?.react(r);
    },
  }), []);

  return (
    <span
      ref={el}
      data-dusk-mark=""
      data-body={shape}
      data-state={shown}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ display: "inline-block", position: "relative", width: size, height: size, flexShrink: 0, ...style }}
      onDoubleClick={animated ? (event) => bot.current?.poke(event.clientX) : undefined}
    />
  );
});

/** A 1px pixel ring one grid step outside a body's silhouette, for a picker's hovered or chosen shape. */
export function BodyRing({ body, size, className }: { body: string; size: number; className?: string }) {
  const d = useMemo(() => ringPath(duskBody(body), size), [body, size]);
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${d.G} ${d.G}`} overflow="visible" shapeRendering="crispEdges" className={className}>
      <path d={d.path} fill="currentColor" />
    </svg>
  );
}

function ringPath(body: string, size: number) {
  const { G, body: silhouette } = stillSvgPaths(body, { size });
  const on = new Set<string>();
  for (const m of silhouette.matchAll(/M(-?\d+) (-?\d+)h(\d+)/g)) for (let i = 0; i < Number(m[3]); i++) on.add(`${Number(m[1]) + i},${m[2]}`);
  const ring = new Set<string>();
  for (const key of on) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${x + dx},${y + dy}`;
      if (!on.has(k)) ring.add(k);
    }
  }
  let path = "";
  for (const key of ring) { const [x, y] = key.split(","); path += `M${x} ${y}h1v1h-1z`; }
  return { G, path };
}
