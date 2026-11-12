import { bucketsOf, matches, type Filters, type Visit } from "./web.ts";

/** per chart bucket, visitors on their first visit and visitors who had been before (anything earlier counts) */
export function newVsReturning(visits: readonly Visit[], from: number, to: number, filters: Filters = {}) {
  const { size, starts } = bucketsOf(from, to);
  const fresh = starts.map(() => new Set<string>()), back = starts.map(() => new Set<string>());
  const firstSeen = new Map<string, number>();
  for (const visit of visits) { const at = firstSeen.get(visit.visitor); if (at === undefined || visit.start < at) firstSeen.set(visit.visitor, visit.start); }
  for (const visit of visits) {
    if (visit.start < from || visit.start >= to || !matches(visit, filters)) continue;
    const i = Math.floor((visit.start - from) / size);
    (firstSeen.get(visit.visitor) === visit.start ? fresh : back)[i]?.add(visit.visitor);
  }
  for (let i = 0; i < starts.length; i++) for (const id of fresh[i]!) back[i]!.delete(id);
  return { new: fresh.map(set => set.size), returning: back.map(set => set.size) };
}

/** visits by weekday (0 sunday) and hour, in the reader's time zone: `offsetMinutes` is what Date#getTimezoneOffset gives there */
export function peakHours(visits: readonly Visit[], from: number, to: number, offsetMinutes: number, filters: Filters = {}) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const visit of visits) {
    if (visit.start < from || visit.start >= to || !matches(visit, filters)) continue;
    const local = new Date(visit.start - offsetMinutes * 60_000);
    grid[local.getUTCDay()]![local.getUTCHours()]! += 1;
  }
  return grid;
}

/** the previous window's values laid on the current window's buckets, so one line can be drawn under the other */
export function aligned(previous: readonly number[], length: number) {
  return Array.from({ length }, (_, i) => previous[i] ?? 0);
}
