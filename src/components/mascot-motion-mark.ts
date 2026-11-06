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
  markClip,
  markFillScale,
  markShapeFor,
  markTree,
  morphSeconds,
  patchMark,
  type MarkAnimator,
  type MarkClip,
  type MarkGaze,
  type MarkNode,
  type MarkPoke,
  type MarkStateDriver,
} from "./mascot-motion-engine";
import { nextFrameAt } from "./mascot-motion";
import { createPersona, type MarkReaction } from "./mascot-personality";
import { OMB_CLIPS } from "./mascot-clips";
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

/** Grok's sand_marks_60fps rate: its default 30 steps visibly on a 60 or 120 Hz display. */
export const MARK_FRAME_RATE = 60;
/** Below this many pixels a mark is compact and idles on Idle_B alone. */
export const COMPACT_MARK_PX = 48;
/** A mark that returns to idle keeps playing this long before it rests (1 ms under reduced motion). */
export const IDLE_SETTLE_MS = 1400;
const IDLE_SETTLE_REDUCED_MS = 1;
/** Grok's sidebar shows a turn's finished or failed state this long after it settles. */
export const SETTLED_HOLD_MS = 8000;
const SETTLED_STATES = new Set<MarkState>(["finished", "failed"]);
/** A turn running: going into one from rest is the bot getting a message. */
const TURN_STATES = new Set<MarkState>(["thinking", "streaming", "reading", "searching", "running", "coding", "working"]);
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

export interface IdleScheduler {
  request(callback: (deadline: { timeRemaining(): number }) => void): void;
}

/** The engine builds a body's geometry the first time it draws it, 2 to 25 ms a shape. */
const WARM_BUDGET_MS = 12;
const warmed = new Set<string>();

/** Builds each body's geometry in idle time, one shape per idle slice, so the first Create New Bot dialog or a newly
 * opened chat draws from the cache instead of paying for it inside a frame. */
export function prewarmMarkShapes(bodies: readonly string[], sizePx: number, idle: IdleScheduler): void {
  const queue = [...new Set(bodies.map(markShape))].filter((shape) => !warmed.has(`${shape}:${sizePx}`));
  if (!queue.length) return;
  for (const shape of queue) warmed.add(`${shape}:${sizePx}`);
  const appearance = markAppearance("#000", "#fff");
  const step = (deadline: { timeRemaining(): number }) => {
    while (queue.length && deadline.timeRemaining() > WARM_BUDGET_MS) {
      const shape = queue.shift()!;
      try {
        markTree(createAnimator({ body: shape }).frame(), appearance, markResolution(sizePx), "mark-warm", { displaySize: sizePx, extent: "100%" });
      } catch {
        // a shape the engine cannot draw at rest is drawn (or not) by its own mark later
      }
    }
    if (queue.length) idle.request(step);
  };
  idle.request(step);
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
  /** Our idle life and reactions on top of Grok's driver; false keeps Grok's still idle. */
  hasPersonality?: boolean;
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
  react(kind: MarkReaction): void;
  /** Plays one of Grok's clips or ours once, then rests: the preview page's play buttons. */
  playClip(name: string): void;
  /** What the engine is playing now; a state with a `next` moves on by itself. */
  readonly state: string;
  /** The clip the state driver picked, null while resting. */
  readonly clip: string | null;
  readonly isSleeping: boolean;
  readonly isDozing: boolean;
  /** The idle act or reaction played last. */
  readonly lastAct: string | null;
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
  let gazeHeld = false;
  // a clip the persona plays on a resting mark loops until we put the mark back to rest
  let oneShotLoop: number | null = null;
  const playOnce = (clip: MarkClip) => {
    animator.load(clip, { isPlaying: true });
    oneShotLoop = playing ? null : animator.loopCount;
  };
  const persona = createPersona(markSeed(t.seed), {
    blink: () => animator.blink(),
    play: playOnce,
    poke: (kind, turns = 1) => animator.poke(kind, { turns }),
    holdFace: (face) => animator.holdFace(face),
  }, markClip);
  const hasPersona = () => t.hasPersonality !== false && !isStill();
  const canIdle = () => hasPersona() && t.isPlaying && !playing && driver.state === "idle" && !gazeHeld;

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
    if (!running) {
      const next = persona.tick(now, canIdle());
      if (animator.isSettled) return next;
      running = true;
      last = now - interval();
    }
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
    if (oneShotLoop !== null && (playing || animator.loopCount !== oneShotLoop)) {
      if (!playing) animator.rest();
      oneShotLoop = null;
    }
    animator.advance(dt);
    draw();
    if (!playing && animator.isSettled) {
      running = false;
      return persona.tick(now, canIdle());
    }
    return nextFrameAt(now, step);
  };

  if (isStill()) settleStill();

  return {
    get state() {
      return driver.state;
    },
    get clip() {
      return driver.clip;
    },
    get isSleeping() {
      return !running;
    },
    get isDozing() {
      return persona.isDozing;
    },
    get lastAct() {
      return persona.lastAct;
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
        persona.touch(env.now());
        driver.setState(t.state);
        restAt = restFor(t.state, env.now());
        lastDriverState = driver.state;
        if (t.state === "happy" && before.state !== "happy" && !isStill()) {
          animator.poke("spin", { turns: 2 });
          animator.poke("bounce");
        }
        if (hasPersona()) {
          if (TURN_STATES.has(t.state) && !TURN_STATES.has(before.state)) persona.react("hop", env.now());
          else if (t.state === "finished") persona.react("cheer", env.now());
          else if (t.state === "failed") persona.react("startle", env.now());
          else if (t.state === "blocked") animator.poke("bounce");
        }
        dirty = true;
      }
      if (changed("isEmphasized")) {
        if (t.isEmphasized) persona.touch(env.now());
        driver.setEmphasis(t.isEmphasized);
        dirty = true;
      }
      if (changed("sizePx")) driver.setCompact(t.sizePx < COMPACT_MARK_PX);
      if (changed("ink") || changed("eye")) appearance = markAppearance(t.ink, t.eye);
      if (changed("isLive") || changed("isReducedMotion") || changed("isPlaying") || changed("state")) syncPlaying();
      if (changed("isLive") || changed("isReducedMotion")) {
        if (isStill()) running = false;
        // the still pose leaves the animator paused, and a paused animator ignores gaze: hand it back to the driver
        else if (playing) animator.play();
        else animator.rest();
        dirty = true;
      }
      if (dirty || changed("ink") || changed("eye") || changed("sizePx") || changed("isPlaying") || changed("maxFrameRate")) refresh();
    },
    gaze(gaze) {
      if (t.isReducedMotion) return;
      gazeHeld = gaze !== null;
      if (gaze) persona.touch(env.now());
      animator.setGaze(gaze ? ([gaze.x, -gaze.y] as MarkGaze) : null);
      refresh();
    },
    poke(kind, turns = 1) {
      if (t.isReducedMotion) return;
      persona.touch(env.now());
      animator.poke(kind, { turns });
      refresh();
    },
    blink() {
      animator.blink();
      refresh();
    },
    playClip(name) {
      if (isStill()) return;
      persona.touch(env.now());
      playOnce(Object.hasOwn(OMB_CLIPS, name) ? OMB_CLIPS[name as keyof typeof OMB_CLIPS] : markClip(name));
      refresh();
    },
    react(kind) {
      if (isStill()) return;
      persona.react(kind, env.now());
      refresh();
    },
    setExpression(face) {
      animator.setExpression(face);
      refresh();
    },
  };
}
