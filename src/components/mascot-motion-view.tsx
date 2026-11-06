import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { mascotClock, usePrefersReducedMotion } from "./mascot-clock";
import { MARK_CANVAS_PERCENT, MARK_POKES, createMark, prewarmMarkShapes, type Mark, type MarkState } from "./mascot-motion-mark";
import type { MarkPoke } from "./mascot-motion-engine";
import type { MarkReaction } from "./mascot-personality";
import { onMascotCue } from "./mascot-events";
import { ATTENTION, attentionGaze, watchPointer, type Point } from "./mascot-attention";
import { opticalTransform } from "./mascot-optics";
import { GROK_BODY_IDS } from "../../shared/grok-bodies";

// grok draws sidebar-size marks and up unscaled; only small marks get the optical fit
const RAW_MARK_PX = 32;

/** The sidebar's and Create New Bot's mark size: their bodies get built ahead, in idle time. */
const WARM_SIZE = 36;
let warmScheduled = false;

/** A mark this small reads the same at half Grok's frame rate, and a room full of them at work costs half as much. */
const SMALL_MARK_PX = 24;
const SMALL_MARK_FPS = 30;

/** How long a mark keeps looking at the composer after the last keystroke. */
const WATCH_MS = 1400;
const COMPOSER_GAZE = { x: 0.15, y: 0.75 };

/** Marks this far outside their scroller (or the window) wait to be drawn until they come this close. */
const DRAW_AHEAD_PX = 480;
/** Server rendering has no layout effects: there the first frame goes out as markup. */
const SERVER = typeof document === "undefined";

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
  /** False keeps Grok's still idle: no blinks, glances or dozing between turns. */
  personality?: boolean;
  /** The bot whose app moments (a message typed, a chat opened) this mark answers. */
  cueKey?: string;
  className?: string;
  style?: CSSProperties;
}

export interface GrokMarkHandle {
  blink: () => void;
  spin: (durationMs?: number) => void;
  setExpression: (index: number) => void;
  /** No kind cycles spin, bounce and nod, like a tap on Grok's status-line mark. */
  poke: (kind?: MarkPoke) => void;
  react: (kind: MarkReaction) => void;
  playClip: (name: string) => void;
}

export const GrokMark = forwardRef<GrokMarkHandle, GrokMarkProps>(function GrokMark(
  { body, ink, eye, state = "idle", size = 44, animated = true, emphasized = false, gaze, seed, expression, label, personality = true, cueKey, className, style },
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
    hasPersonality: personality,
    maxFrameRate: size <= SMALL_MARK_PX ? SMALL_MARK_FPS : undefined,
  };
  const mark = useRef<Mark | null>(null);
  const caughtUp = useRef(() => {});
  const latest = useRef(options);
  latest.current = options;
  // made when first drawn: a mark scrolled far out of view costs nothing until it comes near
  const make = () => (mark.current ??= createMark(latest.current, { clock: mascotClock(), now: () => performance.now() }));
  // one object for the life of the mark: react re-applies innerHTML whenever it gets a new one, painting over the live svg.
  // in a browser the layout effect below draws the first frame instead, so a mark's body is built once, not twice
  const [firstPaint] = useState(() => (SERVER ? { __html: make().markup() } : undefined));
  const host = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLSpanElement>(null);
  const pokes = useRef(0);

  useImperativeHandle(ref, () => ({
    blink: () => mark.current?.blink(),
    spin: () => mark.current?.poke("spin"),
    setExpression: (index: number) => mark.current?.setExpression(FACES[((index % FACES.length) + FACES.length) % FACES.length]!),
    poke: (kind?: MarkPoke) => mark.current?.poke(kind ?? MARK_POKES[pokes.current++ % MARK_POKES.length]!),
    react: (kind: MarkReaction) => mark.current?.react(kind),
    playClip: (name: string) => mark.current?.playClip(name),
  }), []);

  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!cueKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onMascotCue(cueKey, (cue) => {
      if (cue !== "watch") return mark.current?.react(cue);
      setWatching(true);
      clearTimeout(timer);
      timer = setTimeout(() => setWatching(false), WATCH_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [cueKey]);

  // drawn before paint when on screen; a sidebar of many bots draws the rest as they scroll near
  useLayoutEffect(() => {
    const node = canvas.current;
    const at = host.current;
    if (!node || !at) return;
    let detach: (() => void) | undefined;
    const draw = () => (detach ??= make().attach(node, at));
    if (typeof IntersectionObserver !== "function" || near(at)) {
      draw();
      return () => detach?.();
    }
    const watch = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watch.disconnect();
      draw();
      // the gaze and face effects ran while there was no mark to tell
      caughtUp.current();
    }, { root: scrollerOf(at), rootMargin: `${DRAW_AHEAD_PX}px` });
    watch.observe(at);
    return () => {
      watch.disconnect();
      detach?.();
    };
  }, []);

  useEffect(() => {
    if (warmScheduled || typeof requestIdleCallback !== "function") return;
    warmScheduled = true;
    prewarmMarkShapes(GROK_BODY_IDS, WARM_SIZE, { request: (callback) => requestIdleCallback(callback) });
  }, []);

  useEffect(() => {
    mark.current?.update(options);
  });

  const look = gaze ?? (watching && everLive.current ? COMPOSER_GAZE : null);
  const gx = look?.x;
  const gy = look?.y;
  caughtUp.current = () => {
    if (gx !== undefined && gy !== undefined) mark.current?.gaze({ x: gx, y: gy });
    if (expression !== undefined) mark.current?.setExpression(FACES[expression % FACES.length] ?? "neutral");
  };
  const held = useRef(false);
  held.current = gx !== undefined && gy !== undefined;
  useEffect(() => {
    mark.current?.gaze(gx === undefined || gy === undefined ? null : { x: gx, y: gy });
  }, [gx, gy]);

  // a big idle mark looks at a mouse moving near it; a hover or a held gaze owns the mark instead
  const attentive = personality && animated && !reduced && everLive.current && size >= ATTENTION.minPx;
  useEffect(() => {
    if (!attentive) return;
    let rect: DOMRect | null = null;
    let rectAt = -Infinity;
    let last: Point | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      if (!last) return;
      last = null;
      if (!held.current) mark.current?.gaze(null);
    };
    const stop = watchPointer((point) => {
      if (held.current) {
        last = null;
        return;
      }
      if (!point) return release();
      const now = performance.now();
      if (now - rectAt > ATTENTION.rectMs) {
        rect = host.current?.getBoundingClientRect() ?? null;
        rectAt = now;
      }
      const next = rect ? attentionGaze(rect, point) : null;
      if (!next) return release();
      clearTimeout(timer);
      timer = setTimeout(release, ATTENTION.holdMs);
      if (last && last.x === next.x && last.y === next.y) return;
      last = next;
      mark.current?.gaze(next);
    });
    return () => {
      stop();
      release();
    };
  }, [attentive]);

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
      onDoubleClick={everLive.current ? () => mark.current?.react("tap") : undefined}
      style={{ display: "inline-block", position: "relative", flexShrink: 0, width: size, height: size, lineHeight: 0, ...style }}
    >
      <span
        ref={canvas}
        style={{ position: "absolute", left: "50%", top: "50%", width: `${MARK_CANVAS_PERCENT}%`, height: `${MARK_CANVAS_PERCENT}%`, transform: size >= RAW_MARK_PX ? "translate(-50%, -50%)" : opticalTransform(body), pointerEvents: "none" }}
        dangerouslySetInnerHTML={firstPaint}
      />
    </span>
  );
});

/** In the window or close to it; a mark with no box (hidden, or in a test's DOM) counts as near, and is drawn now. */
function near(at: HTMLElement): boolean {
  const box = at.getBoundingClientRect();
  if (!box.width && !box.height) return true;
  return box.bottom > -DRAW_AHEAD_PX && box.top < window.innerHeight + DRAW_AHEAD_PX
    && box.right > -DRAW_AHEAD_PX && box.left < window.innerWidth + DRAW_AHEAD_PX;
}

/** The list a mark scrolls in, so it is drawn a little before it scrolls into view rather than as it does. */
function scrollerOf(at: HTMLElement): HTMLElement | null {
  for (let node = at.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY, overflowX } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY + overflowX)) return node;
  }
  return null;
}
