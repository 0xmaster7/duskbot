// how long something was on screen: time counts only while the page (or the app's window) is visible, so a card left in
// a background tab does not read as a minute of reading.
import { UPSELL_EVENTS, type UpsellStep } from "./cloud-upsell.ts";

/** the bit of `document` a clock needs; absent (server, tests) means always visible */
export interface Visibility {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}
export interface SeenTimer {
  /** visible milliseconds so far, rounded */
  ms(): number;
  /** stops counting until resumed, as when the thing is covered by something else */
  pause(): void;
  resume(): void;
  /** stops listening and returns the visible milliseconds */
  stop(): number;
}

const pageDoc = (): Visibility | undefined => typeof document === "undefined" || typeof document.addEventListener !== "function" ? undefined : document;

export function seenTimer(doc: Visibility | undefined = pageDoc(), now: () => number = Date.now): SeenTimer {
  let total = 0, paused = false, stopped = false;
  const visible = () => !paused && !stopped && (!doc || doc.visibilityState === "visible");
  let since: number | null = visible() ? now() : null;
  const tick = () => {
    const at = now();
    if (since !== null) total += Math.max(0, at - since);
    since = visible() ? at : null;
  };
  doc?.addEventListener("visibilitychange", tick);
  return {
    ms() { tick(); return Math.round(total); },
    pause() { tick(); paused = true; tick(); },
    resume() { tick(); paused = false; tick(); },
    stop() { if (!stopped) { tick(); stopped = true; since = null; doc?.removeEventListener("visibilitychange", tick); } return Math.round(total); },
  };
}

export type UpsellReport = (name: (typeof UPSELL_EVENTS)[UpsellStep], source: string, ms: number | null) => void;
export interface UpsellClock {
  /** shown starts the source's clock (once while it runs); click and dismiss stop it and carry its visible time */
  report(step: Exclude<UpsellStep, "ignored">, source: string): void;
  /** for as long as the upsell is on screen, as an effect: the returned cleanup reports `ignored` with its time when it
   * goes without a click or a dismiss. A watch that starts again straight after (React's strict double effects) keeps the
   * clock running instead. */
  watch(source: string): () => void;
  /** the page is going away: every upsell still open reports `ignored` */
  leave(): void;
}

/** one clock per upsell source; `send` turns a step into that surface's own event */
export function upsellClock(send: UpsellReport, options: { doc?: Visibility; now?: () => number; defer?: (fn: () => void) => void } = {}): UpsellClock {
  const open = new Map<string, { timer: SeenTimer; watchers: number }>();
  const defer = options.defer ?? ((fn: () => void) => { setTimeout(fn, 0); });
  const end = (source: string, step: UpsellStep) => {
    const entry = open.get(source);
    open.delete(source);
    send(UPSELL_EVENTS[step], source, entry ? entry.timer.stop() : null);
  };
  return {
    report(step, source) {
      if (step !== "shown") return end(source, step);
      if (open.has(source)) return;
      open.set(source, { timer: seenTimer(options.doc ?? pageDoc(), options.now), watchers: 0 });
      send(UPSELL_EVENTS.shown, source, null);
    },
    watch(source) {
      const entry = open.get(source);
      if (!entry) return () => {};
      entry.watchers++;
      return () => {
        entry.watchers--;
        defer(() => { if (open.get(source) === entry && entry.watchers <= 0) end(source, "ignored"); });
      };
    },
    leave() { for (const source of open.keys()) end(source, "ignored"); },
  };
}
