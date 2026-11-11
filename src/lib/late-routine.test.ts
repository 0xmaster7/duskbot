import { describe, expect, it } from "vitest";
import { LATE_MS, lateRoutineRun, RECENT_MS } from "./late-routine";

const NOW = Date.UTC(2026, 10, 12, 12);
const routine = { id: "r1", name: "Morning brief", enabled: true, runOn: "maus" as const, schedule: { type: "daily" } as never };
const run = (patch: Record<string, unknown> = {}) => ({
  id: "run1", routineId: "r1", runOn: "maus" as const, manual: false, status: "completed" as const,
  scheduledFor: NOW - 4 * 3_600_000, startedAt: NOW - 4 * 3_600_000 + LATE_MS, ...patch,
}) as never;

describe("a routine that ran late or not at all on this computer", () => {
  it("finds a scheduled run that started half an hour or more after its time", () => {
    expect(lateRoutineRun([routine], [run()], NOW)).toMatchObject({ name: "Morning brief", dueAt: NOW - 4 * 3_600_000, ranAt: NOW - 4 * 3_600_000 + LATE_MS });
  });

  it("finds a run missed while the computer was off, with no time it ran", () => {
    expect(lateRoutineRun([routine], [run({ status: "missed", startedAt: undefined, error: "This computer was offline for more than 12 hours after the scheduled time" })], NOW))
      .toMatchObject({ ranAt: null });
  });

  it("ignores on-time, manual, event, test, retried, cloud and old runs", () => {
    for (const patch of [
      { startedAt: NOW - 4 * 3_600_000 + LATE_MS - 1 }, { manual: true }, { triggerSource: "webhook" }, { dryRun: true }, { retried: "crash" },
      { runOn: "cloud" }, { scheduledFor: NOW - RECENT_MS - 1, startedAt: NOW - RECENT_MS - 1 + LATE_MS },
      { status: "missed", error: "Skipped because the previous run of this routine is still waiting" },
    ]) expect(lateRoutineRun([routine], [run(patch)], NOW), JSON.stringify(patch)).toBeNull();
  });

  it("ignores a routine that is off, held, runs on the Cloud or waits for a limit reset", () => {
    for (const patch of [{ enabled: false }, { heldFor: "no_engine" }, { runOn: "cloud" }, { schedule: { type: "limit_reset" } }]) {
      expect(lateRoutineRun([{ ...routine, ...patch } as never], [run()], NOW), JSON.stringify(patch)).toBeNull();
    }
  });

  it("names the newest one", () => {
    const older = run({ id: "old", scheduledFor: NOW - 30 * 3_600_000, startedAt: NOW - 28 * 3_600_000 });
    expect(lateRoutineRun([routine], [run(), older], NOW)?.runId).toBe("run1");
    expect(lateRoutineRun([routine], [older, run()], NOW)?.runId).toBe("run1");
  });
});
