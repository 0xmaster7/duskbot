import { describe, expect, it } from "vitest";

import type { RoutineRun } from "./routines";
import { automationStatus, runLine } from "./automations";
import { isLimitSkip, routineRunLabel, routineRunTone, routineRunsOn } from "./routine-display";

describe("where a routine runs", () => {
  it("on the Cloud, every routine runs on schedule even when the person's computer is off", () => {
    expect(routineRunsOn({ roomGoal: false, cloudHome: true })).toEqual({
      label: "the cloud", hint: "runs on schedule, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: false, runOn: "cloud", cloudHome: true })).toEqual({
      label: "cloud desktop", hint: "runs the whole job on the bot's cloud desktop, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "cloud", cloudHome: true })).toEqual({
      label: "the bot's cloud desktop", hint: "runs on schedule, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: true, cloudHome: true })).toEqual({
      label: "the cloud, with the whole group", hint: "runs on schedule, even when your computer is off.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "vm", cloudHome: true }).label).toBe("the cloud");
  });

  it("on a desktop, a routine starts while Dusk is open there", () => {
    expect(routineRunsOn({ roomGoal: false, cloudHome: false })).toEqual({
      label: "this computer", hint: "starts while Dusk is open here.",
    });
    expect(routineRunsOn({ roomGoal: false, runOn: "cloud", cloudHome: false })).toEqual({
      label: "cloud desktop", hint: "runs the whole job on the bot's cloud desktop while Dusk is open.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "vm", cloudHome: false }).label).toBe("the bot's private desktop");
    expect(routineRunsOn({ roomGoal: true, cloudHome: false }).label).toBe("this computer, with the whole group");
  });

  it("never names retired desktop provider or a cloud runner", () => {
    for (const cloudHome of [true, false]) {
      for (const input of [{ runOn: "cloud" }, { computer: "cloud" }, {}]) {
        const { label, hint } = routineRunsOn({ roomGoal: false, cloudHome, ...input });
        expect(`${label} ${hint}`).not.toMatch(/\x62oat|runner|VM\b/i);
      }
    }
  });
});

describe("a run's status", () => {
  const run = (patch: Partial<RoutineRun>) => ({ id: "r", routineId: "x", routineName: "Brief", botId: "b", status: "failed", manual: false, scheduledFor: 0, createdAt: 0, ...patch }) as RoutineRun;

  it("reads partly done, in the waiting colour, when only a step failed after the reply came back", () => {
    expect(routineRunLabel(run({ partial: true }))).toBe("partly done");
    expect(routineRunTone(run({ partial: true }))).toBe("text-warning");
    expect(routineRunLabel(run({ partial: true, retried: "failed" }))).toBe("retried after a failure · partly done");
  });

  it("still reads failed, in red, for any other failure", () => {
    expect(routineRunLabel(run({}))).toBe("failed");
    expect(routineRunTone(run({}))).toBe("text-danger");
    expect(routineRunLabel(run({ status: "completed", partial: true }))).toBe("completed");
  });
});

describe("a run the weekly limit skipped", () => {
  const run = (extra: Partial<RoutineRun>): RoutineRun => ({ id: "r", routineId: "x", routineName: "Digest", target: "bot", botId: "b", runOn: "maus",
    scheduledFor: 0, status: "missed", manual: false, createdAt: 0, ...extra });

  it("reads as skipped, never as a failure that needs the person", () => {
    const skipped = run({ error: "skipped: weekly limit reached. it resets Monday 12:00 AM, in 5 days." });
    expect(isLimitSkip(skipped)).toBe(true);
    expect(runLine(skipped)).toMatchObject({ mark: "–", text: "skipped: weekly limit" });
    expect(automationStatus({ enabled: true, runs: [skipped] }).state).not.toBe("needs-you");
    expect(isLimitSkip(run({ error: "this computer was offline for more than 12 hours after the scheduled time" }))).toBe(false);
    expect(isLimitSkip(run({ status: "failed", error: "skipped: weekly limit reached. it resets Monday 12:00 AM, in 5 days." }))).toBe(false);
  });
});
