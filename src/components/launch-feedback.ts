import { useEffect, useState, type RefObject } from "react";

// the bot desktop's dock (deploy/bot-desktop tint2rc): 50px tall at the bottom, three 34px icons 10px apart, centered
const DOCK_HEIGHT = 50;
const DOCK_HALF_WIDTH = 80;
/** how long the ring waits for the app's window before giving up */
export const LAUNCH_MS = 8_000;
const POLL_MS = 250;
const SAMPLE_W = 32;
const SAMPLE_H = 18;

/** Whether a point on the desktop, in its own pixels, is on the dock's launchers. */
export function onDockLauncher(x: number, y: number, width: number, height: number): boolean {
  return width > 0 && height > DOCK_HEIGHT && y >= height - DOCK_HEIGHT && y <= height && Math.abs(x - width / 2) <= DOCK_HALF_WIDTH;
}

/** Whether two small samples of the screen above the dock differ enough to be a new window (a tooltip is not). */
export function screenChanged(before: Uint8ClampedArray, after: Uint8ClampedArray): boolean {
  if (before.length !== after.length || before.length === 0) return false;
  let moved = 0;
  for (let i = 0; i < before.length; i += 4) {
    const delta = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
    if (delta > 48) moved++;
  }
  return moved / (before.length / 4) > 0.08;
}

function sample(canvas: HTMLCanvasElement, into: CanvasRenderingContext2D): Uint8ClampedArray | null {
  try {
    into.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
    into.drawImage(canvas, 0, 0, canvas.width, canvas.height - DOCK_HEIGHT, 0, 0, SAMPLE_W, SAMPLE_H);
    return into.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  } catch {
    return null;
  }
}

/** A click on a dock launcher while in control opens an app, which takes a few seconds on a bot desktop: this gives
 * where to draw a spinning ring round the person's pointer (in `host`'s box) until the screen above the dock changes or
 * LAUNCH_MS passes. The desktop's own pointer is blank, so its busy cursor would never show. */
export function useLaunchFeedback(host: RefObject<HTMLElement | null>, active: boolean): { x: number; y: number } | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element || !active) return setAt(null);
    const probe = document.createElement("canvas");
    probe.width = SAMPLE_W;
    probe.height = SAMPLE_H;
    const context = probe.getContext("2d", { willReadFrequently: true });
    let timer: ReturnType<typeof setInterval> | undefined;
    let spinning = false;
    const stop = () => {
      clearInterval(timer);
      spinning = false;
      setAt(null);
    };
    const place = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      setAt({ x: event.clientX - box.left, y: event.clientY - box.top });
    };
    const down = (event: PointerEvent) => {
      const canvas = event.target instanceof HTMLCanvasElement ? event.target : null;
      if (!canvas || event.button !== 0 || !context) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) * canvas.width / rect.width;
      const y = (event.clientY - rect.top) * canvas.height / rect.height;
      if (!onDockLauncher(x, y, canvas.width, canvas.height)) return;
      const before = sample(canvas, context);
      if (!before) return;
      clearInterval(timer);
      spinning = true;
      place(event);
      const started = performance.now();
      timer = setInterval(() => {
        const now = sample(canvas, context);
        if (performance.now() - started >= LAUNCH_MS || !now || screenChanged(before, now)) stop();
      }, POLL_MS);
    };
    const move = (event: PointerEvent) => { if (spinning) place(event); };
    element.addEventListener("pointerdown", down, true);
    element.addEventListener("pointermove", move, true);
    return () => {
      clearInterval(timer);
      element.removeEventListener("pointerdown", down, true);
      element.removeEventListener("pointermove", move, true);
      setAt(null);
    };
  }, [host, active]);
  return at;
}
