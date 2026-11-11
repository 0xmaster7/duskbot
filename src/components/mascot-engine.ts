// the app's names for what a bot is doing, and the pixel engine's state and reaction each one draws as
import type { PixelReaction, PixelState } from "@/pixel/engine";

/** Every state a bot's mark can be asked to show. */
export const MARK_STATES = [
  "idle", "listening", "thinking", "streaming", "searching", "reading", "working", "coding", "running",
  "computing", "controlling", "waiting", "blocked", "finished", "failed", "sleeping", "waking", "happy",
  "excited", "laughing", "proud", "curious", "playful", "shy", "surprised", "suspicious", "angry",
  "confused", "sad", "drowsy", "bored", "scared", "celebrate", "approving", "orbit", "radar", "progress",
  "spawning", "loading", "dictating", "sending", "receiving", "uploading", "writing", "alerting", "bouncing",
  "powering-down", "humming", "notifying", "dragging", "logo", "showcase", "turntable",
] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** App moments a mark answers with a short move. `open`: its bot was chosen. `tap`: the mark itself was double-clicked. */
export type MarkReaction = "hop" | "greet" | "startle" | "cheer" | "nod" | "spin" | "wiggle" | "lookAround" | "open" | "tap";
export type MarkPoke = "spin" | "bounce" | "nod";
export type MarkGaze = { x: number; y: number };

export const PIXEL_STATE_OF: Record<MarkState, PixelState> = {
  idle: "idle", listening: "listening", thinking: "thinking", streaming: "working", searching: "searching",
  reading: "searching", working: "working", coding: "working", running: "working", computing: "thinking",
  controlling: "working", waiting: "waiting", blocked: "waiting", finished: "done", failed: "error",
  sleeping: "sleeping", waking: "waking", happy: "happy", excited: "excited", laughing: "excited", proud: "happy",
  curious: "listening", playful: "happy", shy: "idle", surprised: "surprised", suspicious: "confused", angry: "error",
  confused: "confused", sad: "sad", drowsy: "sleeping", bored: "waiting", scared: "surprised", celebrate: "excited",
  approving: "happy", orbit: "thinking", radar: "searching", progress: "working", spawning: "happy",
  loading: "thinking", dictating: "listening", sending: "working", receiving: "listening", uploading: "working",
  writing: "working", alerting: "surprised", bouncing: "excited", "powering-down": "sleeping", humming: "happy",
  notifying: "happy", dragging: "surprised", logo: "idle", showcase: "happy", turntable: "idle",
};

const PIXEL_NAMES = new Set<string>(Object.values(PIXEL_STATE_OF));

/** The pixel state any app, dashboard or older state name draws as; unknown names rest. */
export function pixelState(state: string | null | undefined): PixelState {
  if (!state) return "idle";
  if (Object.hasOwn(PIXEL_STATE_OF, state)) return PIXEL_STATE_OF[state as MarkState];
  if (PIXEL_NAMES.has(state)) return state as PixelState;
  return Object.hasOwn(STATE_ALIAS, state) ? STATE_ALIAS[state]! : "idle";
}
const STATE_ALIAS: Record<string, PixelState> = {
  asleep: "sleeping", sleep: "sleeping", listen: "listening", think: "thinking", search: "searching", busy: "working",
  startled: "surprised", excite: "excited", laugh: "excited", joy: "happy", typing: "working", wait: "waiting",
  love: "love", done: "done", error: "error",
};

const REACTION: Record<string, PixelReaction> = {
  hop: "hop", greet: "wobble", startle: "squish", surprise: "squish", cheer: "boing", celebrate: "boing", nod: "nod",
  spin: "spin", twirl: "spin", wiggle: "wobble", lookAround: "nod", peek: "nod", open: "hop", tap: "poke", bounce: "hop",
  perk: "boing", shake: "wobble", squish: "squish", dizzy: "dizzy", nudge: "nod", huff: "wobble", sigh: "nod",
  laugh: "boing", stretch: "hop", swell: "hop", dip: "nod", heart: "heart", love: "heart", boing: "boing", wobble: "wobble",
};

/** The pixel reaction an app or dashboard reaction plays; null for none. */
export function pixelReaction(kind: string): PixelReaction | null {
  return Object.hasOwn(REACTION, kind) ? REACTION[kind]! : null;
}

/** The pixel state each older expression index holds, in its order. */
export const EXPRESSION_STATES: PixelState[] = ["idle", "happy", "surprised", "sad", "sleeping", "confused", "happy", "listening", "confused"];

const f2 = (v: number) => Math.round(v * 100) / 100;

/** A look direction in -1..1 (x right, y down) for a pointer at (x, y), seen from a mark drawn in rect; null past reach px. */
export function pointerGaze(rect: { left: number; top: number; width: number; height: number }, x: number, y: number, reach = 220): MarkGaze | null {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
  if (d > reach) return null;
  const pull = Math.min(1, d / Math.max(rect.width * 0.9, 36));
  return { x: f2((dx / d) * pull), y: f2((dy / d) * pull * 0.8) };
}

/** Where a mark looks for a pointer over or near it, at any distance. */
export function hoverGaze(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): MarkGaze {
  return pointerGaze(rect, x, y, Infinity)!;
}
