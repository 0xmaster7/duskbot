// The account's shared start pool as rolling windows (the last minute, hour and day), the way providers count it: no
// window resets at midnight, a start stops counting a full window after it happened.
import { DAY, WINDOW_MS, type PoolCounts } from "./cost.ts";

export interface RollingPool {
  add(at: number): void;
  used(now: number): PoolCounts;
  /** the moment a window next has room for one more, given a cap (now when it has room already) */
  roomAt(now: number, window: keyof PoolCounts, cap: number): number;
  /** the starts still inside the day window, oldest first */
  times(now: number): number[];
}

export function createRollingPool(initial: readonly number[] = []): RollingPool {
  let list = initial.filter(Number.isFinite).slice().sort((a, b) => a - b), head = 0;
  const lowerBound = (x: number) => {
    let lo = head, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid]! <= x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const prune = (now: number) => {
    head = lowerBound(now - DAY);
    if (head > 4096 && head > list.length / 2) { list = list.slice(head); head = 0; }
  };
  return {
    add(at) {
      if (list.length === head || list[list.length - 1]! <= at) { list.push(at); return; }
      const i = lowerBound(at);
      list.splice(i, 0, at);
    },
    used(now) {
      prune(now);
      const n = list.length;
      return { minute: n - lowerBound(now - WINDOW_MS.minute), hour: n - lowerBound(now - WINDOW_MS.hour), day: n - head };
    },
    roomAt(now, window, cap) {
      prune(now);
      if (cap < 1) return Number.POSITIVE_INFINITY;
      const from = lowerBound(now - WINDOW_MS[window]), inWindow = list.length - from;
      if (inWindow < cap) return now;
      return list[from + inWindow - Math.floor(cap)]! + WINDOW_MS[window] + 1;
    },
    times(now) { prune(now); return list.slice(head); },
  };
}
