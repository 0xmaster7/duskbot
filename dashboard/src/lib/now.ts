import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => { current = Date.now(); listeners.forEach((l) => l()); }, 1000);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
};

/** the clock, rounded down to `step` ms: a component re-renders only when its rounded value changes */
export function useNow(step = 1000): number {
  return useSyncExternalStore(subscribe, () => Math.floor(current / step) * step, () => Math.floor(Date.now() / step) * step);
}
