import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties } from "react";

import { mascotClock, usePrefersReducedMotion } from "./mascot-clock";
import { MARK_CANVAS_PERCENT, MARK_POKES, createMark, prewarmMarkShapes, type Mark, type MarkState } from "./mascot-motion-mark";
import type { MarkPoke } from "./mascot-motion-engine";
import { GROK_BODY_IDS } from "../../shared/grok-bodies";

/** The sidebar's and Create New Bot's mark size: their bodies get built ahead, in idle time. */
const WARM_SIZE = 36;
let warmScheduled = false;

/** Grok's face names, in the order the old expression index picks them. */
const FACES = ["neutral", "happy", "surprised", "sad", "sleepy", "squinted", "calm", "inspecting", "confused"];

export interface GrokMarkProps {
  /** One of the 26 Grok-style body ids. */
  body: string;
  ink: string;
  /** Eye paint; omitted cuts the eyes out of the body. */
  eye?: string;
  state?: MarkState;
  size?: number;
  /** False draws the idle rest pose with no clock, like Grok's static avatars. Once live, false rests the mark instead. */
  animated?: boolean;
  /** Grok's isEmphasized: a face-less state looks surprised while the pointer is on it. */
  emphasized?: boolean;
  /** Where the mark looks, -1..1 on each axis with y down. Grok turns the whole body toward it. */
  gaze?: { x: number; y: number } | null;
  /** Shuffles the idle clips. Marks of the same bot share it, so every copy of a bot moves alike. */
  seed?: string;
  /** Face index from the older expression list, held until it changes. */
  expression?: number;
  label?: string | null;
  className?: string;
  style?: CSSProperties;
}

export interface GrokMarkHandle {
  blink: () => void;
  spin: (durationMs?: number) => void;
  setExpression: (index: number) => void;
  /** No kind cycles spin, bounce and nod, like a tap on Grok's status-line mark. */
  poke: (kind?: MarkPoke) => void;
}

export const GrokMark = forwardRef<GrokMarkHandle, GrokMarkProps>(function GrokMark(
  { body, ink, eye, state = "idle", size = 44, animated = true, emphasized = false, gaze, seed, expression, label, className, style },
  ref,
) {
  const reactId = useId();
  const id = `mark-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reduced = usePrefersReducedMotion();
  // a mark that has ever been live keeps easing to rest instead of snapping to the still pose
  const everLive = useRef(animated);
  if (animated) everLive.current = true;
  // grok's static avatars always draw the idle rest pose, whatever the bot is doing
  const shown = everLive.current ? state : "idle";
  const options = {
    id,
    seed: seed ?? id,
    body,
    ink,
    eye,
    state: shown,
    sizePx: size,
    isLive: everLive.current,
    isPlaying: animated,
    isEmphasized: emphasized,
    isReducedMotion: reduced,
  };
  const mark = useRef<Mark | null>(null);
  mark.current ??= createMark(options, { clock: mascotClock(), now: () => performance.now() });
  const [firstPaint] = useState(() => mark.current!.markup());
  const host = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLSpanElement>(null);
  const pokes = useRef(0);

  useImperativeHandle(ref, () => ({
    blink: () => mark.current?.blink(),
    spin: () => mark.current?.poke("spin"),
    setExpression: (index: number) => mark.current?.setExpression(FACES[((index % FACES.length) + FACES.length) % FACES.length]!),
    poke: (kind?: MarkPoke) => mark.current?.poke(kind ?? MARK_POKES[pokes.current++ % MARK_POKES.length]!),
  }), []);

  useEffect(() => {
    if (!canvas.current || !host.current || !mark.current) return;
    return mark.current.attach(canvas.current, host.current);
  }, []);

  useEffect(() => {
    if (warmScheduled || typeof requestIdleCallback !== "function") return;
    warmScheduled = true;
    prewarmMarkShapes(GROK_BODY_IDS, WARM_SIZE, { request: (callback) => requestIdleCallback(callback) });
  }, []);

  useEffect(() => {
    mark.current?.update(options);
  });

  const gx = gaze?.x;
  const gy = gaze?.y;
  useEffect(() => {
    mark.current?.gaze(gx === undefined || gy === undefined ? null : { x: gx, y: gy });
  }, [gx, gy]);

  useEffect(() => {
    if (expression !== undefined) mark.current?.setExpression(FACES[expression % FACES.length] ?? "neutral");
  }, [expression]);

  return (
    <span
      ref={host}
      className={className ? `grok-bot-mark ${className}` : "grok-bot-mark"}
      data-grok-state={shown}
      data-paused={!animated || undefined}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-block", position: "relative", flexShrink: 0, width: size, height: size, lineHeight: 0, ...style }}
    >
      <span
        ref={canvas}
        style={{ position: "absolute", left: "50%", top: "50%", width: `${MARK_CANVAS_PERCENT}%`, height: `${MARK_CANVAS_PERCENT}%`, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
        dangerouslySetInnerHTML={{ __html: firstPaint }}
      />
    </span>
  );
});
