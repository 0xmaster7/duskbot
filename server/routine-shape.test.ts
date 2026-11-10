import { describe, expect, it } from "vitest";

import { shapeNewRoutine, timeCritical } from "./routine-shape.ts";
import type { RoutineInput } from "./routines.ts";
import { DAYS_NEEDED, placeOf, WAKING_FALLBACK, windowOf } from "./waking-hours.ts";

const frequent = (prompt: string, extra: Partial<RoutineInput> = {}): RoutineInput =>
  ({ name: "Check", prompt, botId: "b", schedule: { type: "interval", everyMinutes: 30, anchorAt: 0 }, ...extra });
const morning = { start: "06:30", end: "23:00" };

describe("time-critical wording keeps the full schedule", () => {
  it.each([
    "Tell me immediately if the site is down", "Alert me as soon as the server goes offline", "check uptime of api.example.com",
    "Watch for suspicious logins (security)", "Ping me any time a big order comes in", "Run 24/7 and watch the queue",
    "Check overnight builds", "URGENT: watch the pager", "Tell me if BTC drops below 60000", "trading signals for my portfolio",
    "Price alert when it goes under $500", "Watch the error threshold", "keep an eye on it around the clock",
  ])("%s", (text) => {
    expect(timeCritical(text)).toBe(true);
    expect(shapeNewRoutine(frequent(text), morning)).toEqual(frequent(text));
  });

  it.each(["Summarise new posts on the team blog", "Check my inbox for newsletters", "Look for new comments on my PR"])("not %s", (text) => {
    expect(timeCritical(text)).toBe(false);
  });
});

describe("shaping a new routine", () => {
  it("runs a frequent one in the waking hours", () => {
    expect(shapeNewRoutine(frequent("Check the shared inbox"), morning).schedule).toEqual({ type: "interval", everyMinutes: 30, anchorAt: 0, window: morning });
  });

  it("keeps a window the person gave, or all day when they said so", () => {
    const own = frequent("Check the shared inbox", { schedule: { type: "interval", everyMinutes: 30, anchorAt: 0, window: { start: "09:00", end: "17:00" } } });
    expect(shapeNewRoutine(own, morning)).toEqual(own);
    const allDay = frequent("Check the shared inbox", { schedule: { type: "interval", everyMinutes: 30, anchorAt: 0, window: null } });
    expect(shapeNewRoutine(allDay, morning)).toEqual(allDay);
  });

  it("leaves rarer intervals, price probes, room goals and unknown waking hours alone", () => {
    const rare = frequent("Check the shared inbox", { schedule: { type: "interval", everyMinutes: 180, anchorAt: 0 } });
    expect(shapeNewRoutine(rare, morning)).toEqual(rare);
    const price = frequent("Watch this jacket", { probe: { kind: "price", url: "https://shop.example/j" } });
    expect(shapeNewRoutine(price, morning)).toEqual(price);
    const room = frequent("Standup notes", { target: "room-goal" });
    expect(shapeNewRoutine(room, morning)).toEqual(room);
    expect(shapeNewRoutine(frequent("Check the shared inbox"), null)).toEqual(frequent("Check the shared inbox"));
  });

  it("makes a daily one in waking hours run around its time, unless pinned, asked otherwise, or at night", () => {
    const daily = (prompt: string, time = "08:00", extra: Partial<RoutineInput> = {}): RoutineInput =>
      ({ name: "Digest", prompt, botId: "b", schedule: { type: "daily", time, weekdays: [1, 2, 3, 4, 5] }, ...extra });
    expect(shapeNewRoutine(daily("Write my morning digest"), morning).timing).toBe("around");
    expect(shapeNewRoutine(daily("Send the report at 8 sharp"), morning).timing).toBeUndefined();
    expect(shapeNewRoutine(daily("Write my digest", "08:00", { timing: null }), morning).timing).toBeNull();
    expect(shapeNewRoutine(daily("Back up my notes", "03:00"), morning).timing).toBeUndefined();
  });
});

describe("learned waking hours", () => {
  const days = (first: number, last: number, count = DAYS_NEEDED) =>
    Object.fromEntries(Array.from({ length: count }, (_, day) => [`2026-11-0${day + 1}`, { first, last }]));

  it("falls back to 7 AM to 11 PM until there are enough days", () => {
    expect(windowOf({})).toEqual(WAKING_FALLBACK);
    expect(windowOf(days(8 * 60, 22 * 60, DAYS_NEEDED - 1))).toEqual(WAKING_FALLBACK);
  });

  it("starts just before the person usually starts and ends after they usually stop", () => {
    expect(windowOf(days(7 * 60 + 40, 22 * 60 + 10))).toEqual({ start: "07:00", end: "22:45" });
  });

  it("keeps the full schedule for someone up past midnight, or with little night", () => {
    expect(windowOf(days(9 * 60, 24 * 60 + 30))).toBeNull();
    expect(windowOf(days(4 * 60 + 10, 23 * 60 + 20))).toBeNull();
  });

  it("counts activity before 4 AM as the night before", () => {
    const late = new Date(2026, 10, 10, 1, 30).getTime();
    expect(placeOf(late)).toEqual({ day: "2026-11-09", minute: 25 * 60 + 30 });
    expect(placeOf(new Date(2026, 10, 10, 6, 0).getTime())).toEqual({ day: "2026-11-10", minute: 360 });
  });
});
