import { beforeEach, describe, expect, it, vi } from "vitest";
import { dailyShowings, dayKey, NUDGE_GAP_MS, NUDGE_KEY, nudgeDue, nudgeEligible, nextNudgeAt, readNudge, type NudgeDay } from "./cloud-nudge";

const HOUR = 3600_000;
const MORNING = new Date(2026, 10, 15, 9).getTime();
const day = (over: Partial<NudgeDay> = {}): NudgeDay => ({ day: dayKey(MORNING), sessions: 1, messages: 0, shown: 0, lastShownAt: 0, ...over });

describe("how many showings a day earns", () => {
  it("none on a day the app is only opened, never used", () => {
    expect(dailyShowings({ sessions: 4, messages: 0 })).toBe(0);
  });
  it("one for light use, two for a steady day, three for a heavy one", () => {
    expect(dailyShowings({ sessions: 1, messages: 1 })).toBe(1);
    expect(dailyShowings({ sessions: 1, messages: 7 })).toBe(1);
    expect(dailyShowings({ sessions: 2, messages: 1 })).toBe(2);
    expect(dailyShowings({ sessions: 1, messages: 8 })).toBe(2);
    expect(dailyShowings({ sessions: 3, messages: 10 })).toBe(3);
    expect(dailyShowings({ sessions: 1, messages: 25 })).toBe(3);
    expect(dailyShowings({ sessions: 9, messages: 500 }), "never more than three").toBe(3);
  });
});

describe("when the next showing may start", () => {
  it("as soon as the day's first message is sent", () => {
    expect(nudgeDue(day(), MORNING)).toBe(false);
    expect(nudgeDue(day({ messages: 1 }), MORNING)).toBe(true);
  });
  it("at least three hours after the last one, and only while the day's cap allows", () => {
    const shown = day({ messages: 30, sessions: 3, shown: 1, lastShownAt: MORNING });
    expect(nudgeDue(shown, MORNING + HOUR)).toBe(false);
    expect(nudgeDue(shown, MORNING + NUDGE_GAP_MS - 1)).toBe(false);
    expect(nudgeDue(shown, MORNING + NUDGE_GAP_MS)).toBe(true);
    expect(nextNudgeAt(shown)).toBe(MORNING + NUDGE_GAP_MS);
    expect(nudgeDue({ ...shown, shown: 3 }, MORNING + 10 * HOUR), "three is the most").toBe(false);
    expect(nextNudgeAt({ ...shown, shown: 3 })).toBeNull();
    const light = day({ messages: 2, shown: 1, lastShownAt: MORNING });
    expect(nudgeDue(light, MORNING + 5 * HOUR), "a light user's one is used").toBe(false);
    expect(nudgeDue({ ...light, messages: 9 }, MORNING + 5 * HOUR), "more use that day earns another").toBe(true);
  });
  it("a new day starts its counts over but keeps the gap across midnight", () => {
    const late = new Date(2026, 10, 15, 23).getTime(), after = late + 2 * HOUR;
    const raw = JSON.stringify({ day: dayKey(late), sessions: 3, messages: 40, shown: 3, lastShownAt: late });
    const next = readNudge(raw, after);
    expect(next).toEqual({ day: dayKey(after), sessions: 0, messages: 0, shown: 0, lastShownAt: late });
    expect(nudgeDue({ ...next, messages: 1 }, after), "still within three hours").toBe(false);
    expect(nudgeDue({ ...next, messages: 1 }, late + NUDGE_GAP_MS)).toBe(true);
  });
  it("reads anything broken as a fresh day", () => {
    for (const raw of [null, "", "{", "[]", JSON.stringify({ day: dayKey(MORNING), shown: -4, messages: "x", lastShownAt: MORNING * 2 })]) {
      const read = readNudge(raw, MORNING);
      expect(read.shown).toBe(0);
      expect(read.messages).toBe(0);
      expect(read.lastShownAt).toBeLessThanOrEqual(MORNING);
    }
  });
});

describe("who never sees it", () => {
  it("only where the offer is allowed (no store build, no dusk cloud yet), after first run, with no corner cloud card", () => {
    expect(nudgeEligible({ allowed: true, settled: true, cornerCard: false })).toBe(true);
    expect(nudgeEligible({ allowed: false, settled: true, cornerCard: false }), "has dusk cloud, or a store build").toBe(false);
    expect(nudgeEligible({ allowed: null, settled: true, cornerCard: false }), "plan still loading").toBe(false);
    expect(nudgeEligible({ allowed: true, settled: false, cornerCard: false }), "first run").toBe(false);
    expect(nudgeEligible({ allowed: true, settled: true, cornerCard: true })).toBe(false);
  });
});

describe("the running app's record", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });

  it("counts a launch once and each message, then holds one showing until it is closed", async () => {
    const nudge = await import("./cloud-nudge");
    nudge.noteNudgeSession(MORNING); nudge.noteNudgeSession(MORNING);
    expect(nudge.nudgeDay(MORNING).sessions).toBe(1);
    expect(nudge.takeNudge(MORNING), "no message yet today").toBe(false);
    nudge.noteNudgeMessage(MORNING);
    expect(nudge.takeNudge(MORNING)).toBe(true);
    expect(nudge.nudgeShowing()).toBe(true);
    expect(nudge.takeNudge(MORNING + 5 * HOUR), "one showing at a time").toBe(false);
    nudge.endNudge();
    expect(nudge.nudgeShowing()).toBe(false);
    expect(nudge.takeNudge(MORNING + 5 * HOUR), "a light day earned one").toBe(false);
    expect(JSON.parse(storage.get(NUDGE_KEY)!)).toMatchObject({ sessions: 1, messages: 1, shown: 1, lastShownAt: MORNING });
  });

  it("a new launch drops a showing nobody closed", async () => {
    let nudge = await import("./cloud-nudge");
    nudge.noteNudgeMessage(MORNING);
    expect(nudge.takeNudge(MORNING)).toBe(true);
    vi.resetModules();
    nudge = await import("./cloud-nudge");
    expect(nudge.nudgeShowing()).toBe(false);
    expect(nudge.takeNudge(MORNING + HOUR), "the gap still holds").toBe(false);
  });
});
