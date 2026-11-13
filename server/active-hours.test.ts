import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActiveHours } from "./active-hours.ts";
import { CHECK_WAKE_MS, CHECK_WAKE_OFF_HOURS_MS, nextCheckAt, nextDueOf } from "./routine-due.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 10).getTime();
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the person's usual hours", () => {
  it("start at 8:00 to 23:00, then follow the hours they used the home in on two or more of the last 14 days, kept across restarts", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "dusk-active-hours-")); dirs.push(dataDir);
    let now = at(10, 12);
    const hours = createActiveHours({ dataDir, now: () => now });
    expect(hours.active(at(10, 9))).toBe(true);
    expect(hours.active(at(10, 3))).toBe(false);
    for (const day of [10, 11, 12]) for (const hour of [2, 3]) hours.note(at(day, hour));
    now = at(12, 12);
    const again = createActiveHours({ dataDir, now: () => now });
    expect(again.active(at(12, 3))).toBe(true);
    expect(again.active(at(12, 9))).toBe(false);
    // fourteen days later it has forgotten them, and goes back to the default
    now = at(12, 12) + 15 * DAY;
    expect(again.active(now)).toBe(true);
    expect(again.active(at(12, 3) + 15 * DAY)).toBe(false);
  });
});

describe("a sleeping Cloud's check spacing", () => {
  const daytime = { active: (t: number) => { const h = new Date(t).getHours(); return h >= 8 && h < 23; }, lastActivityAt: () => null as number | null };
  it("checks hourly in the person's hours and every 3 hours outside them, sooner when their hours begin", () => {
    expect(nextCheckAt(at(10, 12), {}, daytime)).toBe(at(10, 12) + CHECK_WAKE_MS);
    expect(nextCheckAt(at(10, 1), {}, daytime)).toBe(at(10, 1) + CHECK_WAKE_OFF_HOURS_MS);
    expect(nextCheckAt(at(10, 6), {}, daytime)).toBe(at(10, 8));
    expect(nextCheckAt(at(10, 12), {}, undefined)).toBe(at(10, 12) + CHECK_WAKE_MS);
  });

  it("skips one after three checks in a row found nothing, until something is found or the person uses the home", () => {
    const quiet = { quietChecks: 3, quietSince: at(10, 9) };
    expect(nextCheckAt(at(10, 12), quiet, daytime)).toBe(at(10, 14));
    expect(nextCheckAt(at(10, 12), { quietChecks: 2, quietSince: at(10, 9) }, daytime)).toBe(at(10, 13));
    expect(nextCheckAt(at(10, 12), quiet, { ...daytime, lastActivityAt: () => at(10, 11) })).toBe(at(10, 13));
  });

  it("never moves a routine's own scheduled run", () => {
    const routine = { enabled: true, nextRunAt: at(10, 12) + 20 * 60_000, checks: undefined, wakeAt: undefined, checkedAt: undefined };
    expect(nextDueOf([routine], [], at(10, 12), { active: () => false, lastActivityAt: () => null })).toBe(at(10, 12) + 20 * 60_000);
  });
});
