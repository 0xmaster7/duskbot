// Grok Bot's mark controller (its `p_` and the GrokBotMark policy around it), driven by the shared mascot clock instead of
// one requestAnimationFrame loop per mark. The motion itself (clips, springs, gaze, blinks, body geometry) is Grok's own
// engine in mascot-motion-engine.js; this file decides when it plays, rests, sleeps and draws.
import {
  MARK_FILL,
  MARK_RECIPES,
  createAnimator,
  createStateDriver,
  gazeFromPointer,
  markAppearance,
  markFillScale,
  markShapeFor,
  markTree,
  morphSeconds,
  patchMark,
  type MarkAnimator,
  type MarkGaze,
  type MarkNode,
  type MarkPoke,
  type MarkStateDriver,
} from "./mascot-motion-engine";
import { nextFrameAt } from "./mascot-motion";
import type { MascotClock, MascotTicket } from "./mascot-clock";

/** Every state Grok's mark knows, ours included: idle, working, streaming, blocked, finished and the rest. */
export const MARK_STATES = Object.keys(MARK_RECIPES) as MarkState[];

export type MarkState =
  | "idle" | "listening" | "thinking" | "streaming" | "searching" | "reading" | "working" | "coding" | "running"
  | "computing" | "controlling" | "waiting" | "blocked" | "finished" | "failed" | "sleeping" | "waking" | "happy"
  | "excited" | "laughing" | "proud" | "curious" | "playful" | "shy" | "surprised" | "suspicious" | "angry"
  | "confused" | "sad" | "drowsy" | "bored" | "scared" | "celebrate" | "approving" | "orbit" | "radar" | "progress"
  | "spawning" | "loading" | "dictating" | "sending" | "receiving" | "uploading" | "writing" | "alerting" | "bouncing"
  | "powering-down" | "humming" | "notifying" | "dragging" | "logo" | "showcase" | "turntable";

export const isMarkState = (value: unknown): value is MarkState => typeof value === "string" && Object.hasOwn(MARK_RECIPES, value);

/** Grok draws at 30 frames a second unless its sand_marks_60fps gate is on. */
export const MARK_FRAME_RATE = 30;
/** Below this many pixels a mark is compact and idles on Idle_B alone. */
export const COMPACT_MARK_PX = 48;
/** A mark that returns to idle keeps playing this long before it rests (1 ms under reduced motion). */
export const IDLE_SETTLE_MS = 1400;
const IDLE_SETTLE_REDUCED_MS = 1;
/** Grok's sidebar shows a turn's finished or failed state this long after it settles. */
export const SETTLED_HOLD_MS = 8000;
const SETTLED_STATES = new Set<MarkState>(["finished", "failed"]);
/** A still mark is the rest pose after 60 steps of 0.1 s. */
const STILL_STEPS = 60;
const STILL_STEP_S = 0.1;
/** Hover gaze reaches full turn half a mark's width from its centre. */
export const HOVER_GAZE_RANGE = 0.5;
/** The status line's tap cycles these. */
export const MARK_POKES: MarkPoke[] = ["spin", "bounce", "nod"];
/** How long `spawning` holds before the status line hands over to the turn's own state. */
export const SPAWN_MS = morphSeconds("spawning") * 1000;

/** Our 26 Grok-style body ids as the engine names them. Fruit is Grok's pumpkin, painted stem and all. */
export function markShape(body: string): string {
  return body === "fruit" ? "pumpkin" : markShapeFor(body);
}

/** Grok's seed: FNV-1a of the mark's id, so each bot shuffles its idle clips its own way, the same way every time. */
export function markSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Gaze for a pointer over a mark, the way Grok's attachMarkHoverGaze measures it, with y pointing down like ours. */
export function hoverGaze(markRect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const [x, y] = gazeFromPointer(markRect, { x: clientX, y: clientY }, HOVER_GAZE_RANGE);
  return { x, y: -y };
}

export function markResolution(sizePx: number): number {
  return Math.round(sizePx * markFillScale(MARK_FILL) * 100) / 100;
}

/** The canvas span is wider than the mark so a turning, squashing body never clips: 0.92 / 0.6 of it. */
export const MARK_CANVAS_PERCENT = markFillScale(MARK_FILL) * 100;

const ATTR_ESCAPE: Record<string, string> = { "&": "&amp;", '"': "&quot;", "<": "&lt;" };

/** Serialises an engine tree, for the first paint and for server rendering. */
export function markMarkup(node: MarkNode): string {
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${String(value).replace(/[&"<]/g, (c) => ATTR_ESCAPE[c]!)}"`).join("");
  return `<${node.tag}${attrs}>${node.children.map(markMarkup).join("")}</${node.tag}>`;
}

export interface MarkOptions {
  /** Unique per mounted mark: the engine names its mask and clip ids after it. */
  id: string;
  seed: string;
  body: string;
  /** CSS paint for the body. */
  ink: string;
  /** CSS paint for the eyes; omitted cuts them out of the body. */
  eye?: string;
  state: MarkState;
  sizePx: number;
  /** False draws the settled rest pose once and never schedules a frame: Grok's isStatic. */
  isLive: boolean;
  /** False rests the mark even in a busy state, easing out and then sleeping: Grok's isPaused. */
  isPlaying: boolean;
  isEmphasized: boolean;
  isReducedMotion: boolean;
  maxFrameRate?: number;
}

export interface MarkEnvironment {
  clock: MascotClock;
  now(): number;
}

export interface Mark {
  /** The current frame as markup, for the first render. */
  markup(): string;
  attach(canvas: Element, host: Element): () => void;
  update(options: Partial<MarkOptions>): void;
  gaze(gaze: { x: number; y: number } | null): void;
  poke(kind: MarkPoke, turns?: number): void;
  blink(): void;
  setExpression(face: string): void;
  /** What the engine is playing now; a state with a `next` moves on by itself. */
  readonly state: string;
  readonly isSleeping: boolean;
}

export function createMark(initial: MarkOptions, env: MarkEnvironment): Mark {
  let t = initial;
  const isStill = () => !t.isLive || t.isReducedMotion;
  const settleMs = () => (t.isReducedMotion ? IDLE_SETTLE_REDUCED_MS : IDLE_SETTLE_MS);
  // when the mark may rest: grok pauses an idle mark 1.4 s after it got there, and shows finished or failed for 8 s
  const restFor = (state: MarkState, since: number) => {
    if (state === "idle") return since + settleMs();
    return SETTLED_STATES.has(state) ? since + SETTLED_HOLD_MS + settleMs() : Infinity;
  };
  let restAt = t.state === "idle" ? -Infinity : restFor(t.state, env.now());
  const isPlaying = () => t.isPlaying && !isStill() && env.now() < restAt;

  const animator: MarkAnimator = createAnimator({ body: markShape(t.body) });
  const driver: MarkStateDriver = createStateDriver(animator, t.state, {
    seed: markSeed(t.seed),
    isCompact: t.sizePx < COMPACT_MARK_PX,
    isResting: !isPlaying(),
  });
  let playing = isPlaying();
  let appearance = markAppearance(t.ink, t.eye);
  let canvas: Element | null = null;
  let ticket: MascotTicket | null = null;
  let running = false;
  let last = 0;
  let lastDriverState = driver.state;

  const tree = () => markTree(animator.frame(), appearance, markResolution(t.sizePx), t.id, { displaySize: t.sizePx, extent: "100%" });
  const draw = () => {
    if (canvas) patchMark(canvas, tree());
  };
  const interval = () => 1000 / Math.max(1, t.maxFrameRate ?? MARK_FRAME_RATE);
  const settleStill = () => {
    animator.pause();
    animator.seek(0);
    for (let i = 0; i < STILL_STEPS; i++) animator.advance(STILL_STEP_S);
  };
  const wake = () => {
    if (!ticket || running || isStill()) return;
    running = true;
    last = env.now();
    ticket.wake(nextFrameAt(last, interval()));
  };
  const refresh = () => {
    if (isStill()) {
      settleStill();
      draw();
    } else {
      draw();
      wake();
    }
  };
  const syncPlaying = () => {
    const next = isPlaying();
    if (next === playing) return;
    playing = next;
    driver.setResting(!next);
  };

  const frame = (now: number): number => {
    if (!running) return Infinity;
    const step = interval();
    if (now - last < step - 1) return last + step;
    const dt = (now - last) / 1000;
    last = now;
    if (playing) driver.advance(dt);
    if (driver.state !== lastDriverState) {
      // a state with a `next` (finished, failed, waking) moved on to idle by itself: rest like any idle mark
      if (driver.state === "idle" && restAt === Infinity) restAt = now + settleMs();
      lastDriverState = driver.state;
    }
    syncPlaying();
    animator.advance(dt);
    draw();
    if (!playing && animator.isSettled) {
      running = false;
      return Infinity;
    }
    return nextFrameAt(now, step);
  };

  if (isStill()) settleStill();

  return {
    get state() {
      return driver.state;
    },
    get isSleeping() {
      return !running;
    },
    markup: () => markMarkup(tree()),
    attach(nextCanvas, host) {
      canvas = nextCanvas;
      ticket?.remove();
      running = false;
      ticket = env.clock.add(frame, host);
      refresh();
      return () => {
        if (canvas !== nextCanvas) return;
        ticket?.remove();
        ticket = null;
        canvas = null;
        running = false;
      };
    },
    update(changes) {
      const before = t;
      t = { ...t, ...changes };
      const changed = (key: keyof MarkOptions) => !Object.is(before[key], t[key]);
      let dirty = false;
      if (changed("body")) {
        animator.setBody(markShape(t.body), { isInstant: isStill() });
        dirty = true;
      }
      if (changed("state")) {
        driver.setState(t.state);
        restAt = restFor(t.state, env.now());
        lastDriverState = driver.state;
        if (t.state === "happy" && before.state !== "happy" && !isStill()) {
          animator.poke("spin", { turns: 2 });
          animator.poke("bounce");
        }
        dirty = true;
      }
      if (changed("isEmphasized")) {
        driver.setEmphasis(t.isEmphasized);
        dirty = true;
      }
      if (changed("sizePx")) driver.setCompact(t.sizePx < COMPACT_MARK_PX);
      if (changed("ink") || changed("eye")) appearance = markAppearance(t.ink, t.eye);
      if (changed("isLive") || changed("isReducedMotion") || changed("isPlaying") || changed("state")) syncPlaying();
      if (changed("isLive") || changed("isReducedMotion")) {
        if (isStill()) running = false;
        dirty = true;
      }
      if (dirty || changed("ink") || changed("eye") || changed("sizePx") || changed("isPlaying") || changed("maxFrameRate")) refresh();
    },
    gaze(gaze) {
      if (t.isReducedMotion) return;
      animator.setGaze(gaze ? ([gaze.x, -gaze.y] as MarkGaze) : null);
      refresh();
    },
    poke(kind, turns = 1) {
      if (t.isReducedMotion) return;
      animator.poke(kind, { turns });
      refresh();
    },
    blink() {
      animator.blink();
      refresh();
    },
    setExpression(face) {
      animator.setExpression(face);
      refresh();
    },
  };
}
