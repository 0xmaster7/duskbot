// A big mark notices a mouse moving near it and looks at it, then loses interest once the pointer rests, so its own
// idle life picks up again. Adapted from threebot's avatar player (MIT): one shared window listener, a rect re-read at
// most every 250 ms, and the tanh falloff with its 0.7 attention cap.

export const ATTENTION = {
  /** Threebot follows the pointer from 48 px; smaller marks only answer a hover. */
  minPx: 48,
  /** How far from its centre a mark notices the pointer, in mark widths. */
  rangeMarks: 3,
  /** The pointer still this long, the mark looks away. */
  holdMs: 1_600,
  /** Threebot's falloff distance: at least this many px, or the mark's own size. */
  falloffPx: 160,
  strength: 0.7,
  rectMs: 250,
} as const;

export type Point = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };

/** Gaze toward a pointer near a mark, -1..1 with y down, or null when it is out of range. */
export function attentionGaze(rect: Rect, point: Point): Point | null {
  const dx = point.x - (rect.left + rect.width / 2);
  const dy = point.y - (rect.top + rect.height / 2);
  const size = Math.max(rect.width, rect.height);
  if (!(size > 0) || Math.hypot(dx, dy) > size * ATTENTION.rangeMarks) return null;
  const r = Math.max(size, ATTENTION.falloffPx);
  const x = dx / r;
  const y = dy / r;
  const d = Math.hypot(x, y);
  if (d < 1e-9) return { x: 0, y: 0 };
  const k = (Math.tanh(d) / d) * ATTENTION.strength;
  // a couple of hundred steps across is finer than a pixel of turn, and lets a repeat skip the redraw
  const step = (value: number) => Math.round(value * 100) / 100 || 0;
  return { x: step(x * k), y: step(y * k) };
}

const listeners = new Set<(point: Point | null) => void>();
let detach: (() => void) | null = null;

function attach(): () => void {
  const send = (point: Point | null) => {
    for (const listener of Array.from(listeners)) listener(point);
  };
  // a touch is a tap, not a pointer passing by
  const move = (event: PointerEvent) => send(event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY });
  const out = (event: PointerEvent) => {
    if (!event.relatedTarget) send(null);
  };
  const lost = () => send(null);
  const hidden = () => {
    if (document.hidden) send(null);
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerout", out);
  window.addEventListener("blur", lost);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerout", out);
    window.removeEventListener("blur", lost);
    document.removeEventListener("visibilitychange", hidden);
  };
}

/** Calls back with the window's pointer, or null when it leaves; the last watcher to stop removes the listeners. */
export function watchPointer(listener: (point: Point | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(listener);
  detach ??= attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}
