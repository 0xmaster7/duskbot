// Whether the pointer at the screen's edge means "show me the dock" or is just passing: brushing the edge on the way
// to a scrollbar, sliding along it, dragging something, or sitting there after a window switch opens nothing.
// The dock comes out when the pointer arrives at the edge from the screen and rests there; a click there opens it
// at once.

export const REVEAL = Object.freeze({
  /** resting at the edge this long brings the dock out */
  dwellMs: 200,
  /** moving less than this still counts as resting; more starts the rest over, so sliding along the edge never opens */
  settlePx: 10,
  /** after the dock's window gains or loses focus, the edge is ignored this long */
  quietMs: 700,
});

export interface EdgePoint { x: number; y: number; inZone: boolean; buttons?: number; at?: number }

export interface EdgeIntent {
  /** every pointer move the dock's page sees, in the edge zone or not */
  point(next: EdgePoint): void;
  /** a click in the zone: the deliberate way in, no wait */
  press(): void;
  /** the pointer left the page, or the dock came out some other way */
  reset(): void;
  /** something just changed focus: hold off for a moment */
  quiet(at?: number): void;
  dispose(): void;
}

export function createEdgeIntent(open: () => void, now: () => number = Date.now): EdgeIntent {
  let arrived = false;
  let inZone = false;
  let quietUntil = -Infinity;
  let anchor: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearTimeout(timer); timer = undefined; anchor = null; };
  const fire = () => { timer = undefined; anchor = null; arrived = false; open(); };
  return {
    point({ x, y, inZone: zone, buttons = 0, at = now() }) {
      if (!zone) {
        inZone = false;
        arrived = false;
        stop();
        return;
      }
      if (!inZone) {
        inZone = true;
        // the dock's window is a thin strip that sees the pointer only once it is there, so every arrival counts;
        // window switches are held back by quiet() instead
        arrived = true;
      }
      // held buttons are a drag or a selection on its way somewhere; a rest only counts once they are up
      if (!arrived || buttons !== 0 || at < quietUntil) { stop(); return; }
      if (anchor && Math.hypot(x - anchor.x, y - anchor.y) <= REVEAL.settlePx) return;
      clearTimeout(timer);
      anchor = { x, y };
      timer = setTimeout(fire, REVEAL.dwellMs);
    },
    press() {
      if (!inZone) return;
      stop();
      arrived = false;
      open();
    },
    reset() {
      inZone = false;
      arrived = false;
      stop();
    },
    quiet(at = now()) {
      quietUntil = at + REVEAL.quietMs;
      stop();
    },
    dispose: stop,
  };
}
