// The person's waking hours, learned from when they use the app (their first and last activity each day, in this
// computer's local time, which is the time routines run on). Frequent routines made without a time window run inside
// them (server/routine-shape.ts), so a Cloud home can sleep at night. Kept as minutes per day, at most 21 days.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { RoutineIntervalWindow } from "../shared/routines.ts";
import { writeFileAtomic } from "./atomic.ts";

export const WAKING_FALLBACK: RoutineIntervalWindow = { start: "07:00", end: "23:00" };
const FILE = "waking-hours.json";
const DAYS_KEPT = 21;
/** Days of activity before the learned window replaces the fallback. */
export const DAYS_NEEDED = 5;
/** Activity before this hour belongs to the day before: a late night, not an early morning. */
const NIGHT_ENDS = 4 * 60;
/** The first run lands this long before the person usually starts. */
const LEAD = 30;
const TAIL = 30;
/** A window that leaves less quiet than this is not worth shaping. */
const MIN_QUIET = 4 * 60;
const DAY = 24 * 60;

type Days = Record<string, { first: number; last: number }>;

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };

/** One activity's day and minute: before 4 AM counts as the night before, past 24:00. */
export function placeOf(at: number): { day: string; minute: number } {
  const date = new Date(at);
  let minute = date.getHours() * 60 + date.getMinutes();
  if (minute < NIGHT_ENDS) { date.setDate(date.getDate() - 1); minute += DAY; }
  return { day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, minute };
}

/** The window from these days: the usual first activity less a lead, the usual last plus a tail, on 15-minute marks.
 * Null when it cannot be one window inside a day (they are up past midnight) or would leave under four quiet hours. */
export function windowOf(days: Days): RoutineIntervalWindow | null {
  const values = Object.values(days);
  if (values.length < DAYS_NEEDED) return WAKING_FALLBACK;
  const start = Math.max(0, Math.floor((median(values.map((day) => day.first)) - LEAD) / 15) * 15);
  const end = Math.ceil((median(values.map((day) => day.last)) + TAIL) / 15) * 15;
  if (end >= DAY || start >= end || DAY - (end - start) < MIN_QUIET) return null;
  return { start: clock(start), end: clock(end) };
}

export function createWakingHours(options: { dataDir: string; now?: () => number }) {
  const file = join(options.dataDir, FILE);
  const now = options.now ?? Date.now;
  let days: Days = {};
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { days?: Days };
    for (const [day, entry] of Object.entries(value.days ?? {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(entry?.first) && Number.isInteger(entry?.last) && entry.first <= entry.last) days[day] = { first: entry.first, last: entry.last };
    }
  } catch { /* none yet */ }
  let savedAt = 0;
  const save = () => {
    try { writeFileAtomic(file, JSON.stringify({ days }), { mode: 0o600 }); }
    catch (error) { console.warn(`waking hours: could not save: ${error instanceof Error ? error.message : String(error)}`); }
  };
  return {
    /** The person used the app now. Saved at most every ten minutes, and whenever a day's bounds move. */
    note(at = now()): void {
      const { day, minute } = placeOf(at);
      const entry = days[day];
      const moved = !entry || minute < entry.first;
      days[day] = entry ? { first: Math.min(entry.first, minute), last: Math.max(entry.last, minute) } : { first: minute, last: minute };
      const kept = Object.keys(days).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - DAYS_KEPT))) delete days[old];
      if (moved || at - savedAt > 10 * 60_000) { savedAt = at; save(); }
    },
    window: (): RoutineIntervalWindow | null => windowOf(days),
  };
}

export type WakingHours = ReturnType<typeof createWakingHours>;
