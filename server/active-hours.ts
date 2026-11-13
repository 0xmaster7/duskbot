// When the person is usually around, learned from their own input on a Cloud home over the last 14 days, by hour of
// their day (the server runs in their time zone, server/time-zone.ts). A sleeping home checks its routines' apps hourly
// inside these hours and every 3 hours outside them (server/routine-due.ts). Only hours of the day are kept, never what
// was done.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";

export const ACTIVE_HOURS_FILE = "active-hours.json";
/** the days kept, and how many of them an hour needs input on to count as one the person is usually around */
export const ACTIVE_HOURS_DAYS = 14;
const MIN_DAYS_SEEN = 2, MIN_DAYS_LEARNED = 3;
/** until enough days are seen: 8:00 to 23:00 */
export const DEFAULT_ACTIVE = { from: 8, to: 23 };

const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function createActiveHours(options: { dataDir?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now, path = options.dataDir ? join(options.dataDir, ACTIVE_HOURS_FILE) : null;
  /** day (local YYYY-MM-DD) -> bit per hour of that day with input */
  let days: Record<string, number> = {};
  if (path) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as { days?: unknown };
      if (value.days && typeof value.days === "object") for (const [key, mask] of Object.entries(value.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isInteger(mask)) days[key] = (mask as number) & 0xffffff;
    } catch { /* none yet */ }
  }
  const prune = (at: number) => {
    const keep = new Set(Array.from({ length: ACTIVE_HOURS_DAYS }, (_, i) => dayKey(at - i * 86_400_000)));
    days = Object.fromEntries(Object.entries(days).filter(([key]) => keep.has(key)));
  };
  return {
    /** the person used the home at `at`: written only the first time in each hour */
    note(at = now()) {
      const key = dayKey(at), bit = 1 << new Date(at).getHours();
      if ((days[key] ?? 0) & bit) return;
      days[key] = (days[key] ?? 0) | bit;
      prune(at);
      if (path) try { writeFileAtomic(path, JSON.stringify({ v: 1, days })); } catch { /* best effort: the default hours still hold */ }
    },
    /** whether the hour holding `at` is one the person is usually around in */
    active(at: number): boolean {
      prune(now());
      const hour = new Date(at).getHours(), masks = Object.values(days);
      if (masks.filter((mask) => mask !== 0).length < MIN_DAYS_LEARNED) return hour >= DEFAULT_ACTIVE.from && hour < DEFAULT_ACTIVE.to;
      return masks.filter((mask) => mask & (1 << hour)).length >= MIN_DAYS_SEEN;
    },
  };
}
export type ActiveHours = ReturnType<typeof createActiveHours>;
