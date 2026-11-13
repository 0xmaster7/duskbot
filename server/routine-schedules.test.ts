import { describe, expect, it } from "vitest";

import { cleanSchedule, mergeScheduleUpdate, nextOccurrence, type RoutineScheduleInput } from "./routine-schedules.ts";

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HOUR = 3_600_000;

describe("an interval schedule over POST /api/routines", () => {
  it("takes its start as epoch milliseconds, as the app sends it, and the scheduler runs it", () => {
    const schedule = cleanSchedule({ type: "interval", everyMinutes: 60, anchorAt: NOW + HOUR, weekdays: null, endsAt: null }, NOW);
    expect(schedule).toEqual({ type: "interval", everyMinutes: 60, anchorAt: NOW + HOUR });
    expect(nextOccurrence(schedule, NOW)).toBe(NOW + HOUR);
  });

  it("takes its start and end as RFC3339 with an offset, as a bot's routine tool writes them", () => {
    const schedule = cleanSchedule({ type: "interval", everyMinutes: 60, anchorAt: "2026-11-13T18:30:00+05:30", endsAt: "2026-11-20T13:00:00Z" }, NOW);
    expect(schedule).toEqual({ type: "interval", everyMinutes: 60, anchorAt: NOW + HOUR, endsAt: NOW + 7 * 24 * HOUR + HOUR });
    expect(nextOccurrence(schedule, NOW)).toBe(NOW + HOUR);
  });

  it("starts one interval from now when no start is given", () => {
    const schedule = cleanSchedule({ type: "interval", everyMinutes: 30 }, NOW);
    expect(schedule).toEqual({ type: "interval", everyMinutes: 30, anchorAt: NOW });
    expect(nextOccurrence(schedule, NOW)).toBe(NOW + 30 * 60_000);
  });

  it.each(["2026-11-13T18:30:00", "2026-02-30T09:00:00Z", "tomorrow", ""])("refuses the start %j", (anchorAt) => {
    expect(() => cleanSchedule({ type: "interval", everyMinutes: 60, anchorAt }, NOW)).toThrow("Choose a valid interval start time");
  });

  it("refuses an RFC3339 end before its start", () => {
    expect(() => cleanSchedule({ type: "interval", everyMinutes: 60, anchorAt: NOW, endsAt: "2026-11-12T00:00:00Z" }, NOW))
      .toThrow("Choose a valid interval end time after its start");
  });

  it("keeps the current start on an edit that only changes the cadence", () => {
    const current = cleanSchedule({ type: "interval", everyMinutes: 60, anchorAt: NOW - 5 * HOUR }, NOW);
    const merged = mergeScheduleUpdate(current, { type: "interval", everyMinutes: 120 } as RoutineScheduleInput);
    expect(cleanSchedule(merged, NOW)).toEqual({ type: "interval", everyMinutes: 120, anchorAt: NOW - 5 * HOUR });
  });
});
