import { describe, expect, it } from "vitest";

import { SELF_CAP_STOP, stripOf } from "./routine-quiet.ts";
import { createRoutineSelfCap } from "./routine-self-cap.ts";
import type { RoutineRun } from "./routines.ts";

const run = (extra: Partial<RoutineRun> = {}): RoutineRun => ({ id: "run-1", routineId: "r1", routineName: "Digest", target: "bot", botId: "b", runOn: "maus",
  scheduledFor: 0, status: "running", manual: false, createdAt: 0, threadId: "t1", ...extra });

function harness(current: RoutineRun | null, usual: number | null, perToken = 0.001) {
  const stops: Array<{ reason: string; spent: number; usual: number }> = [];
  const cap = createRoutineSelfCap({
    run: () => current, usual: () => usual,
    estimate: (_thread, usage) => (perToken === 0 ? null : (usage.input + usage.output) * perToken),
    stop: (_run, reason, spent, usualUsd) => stops.push({ reason, spent, usual: usualUsd }),
  });
  return { cap, stops };
}

describe("a routine's self-cap", () => {
  it("stops a scheduled run once, past three times its usual cost, counting its earlier turns", () => {
    const h = harness(run({ cost: 0.1 }), 0.1);
    h.cap.usage("t1", { input: 150, output: 40 });
    expect(h.stops).toEqual([]);
    h.cap.usage("t1", { input: 160, output: 50 });
    expect(h.stops).toHaveLength(1);
    expect(h.stops[0]!.reason.startsWith(SELF_CAP_STOP)).toBe(true);
    h.cap.usage("t1", { input: 400, output: 50 });
    expect(h.stops).toHaveLength(1);
  });

  it("never stops a run someone started, a test, a routine with no usual cost yet, or an unpriced model", () => {
    for (const [current, usual, price] of [[run({ manual: true }), 0.01, 0.001], [run({ dryRun: true }), 0.01, 0.001], [run(), null, 0.001], [run(), 0.01, 0]] as const) {
      const h = harness(current, usual, price);
      h.cap.usage("t1", { input: 10_000, output: 10_000 });
      expect(h.stops).toEqual([]);
    }
  });

  it("shows a self-capped run as failed on the strip", () => {
    const strip = stripOf([
      run({ id: "a", status: "completed", finishedAt: 1, report: { state: "quiet" } }),
      run({ id: "b", status: "cancelled", finishedAt: 2, error: `${SELF_CAP_STOP}: 0.40 dollars against a usual 0.10` }),
      run({ id: "c", status: "cancelled", finishedAt: 3, error: "The routine was paused before this run started" }),
      run({ id: "d", status: "missed", finishedAt: 4 }),
      run({ id: "e", status: "completed", finishedAt: 5, dryRun: true }),
      run({ id: "f", status: "completed", finishedAt: 6 }),
    ], { id: "r1", ticks: [{ at: 0, outcome: "quiet" }] });
    expect(strip.map((entry) => entry.outcome)).toEqual(["quiet", "quiet", "failed", "missed", "ok"]);
  });
});
