import { expect, test } from "vitest";
import type { RoutineReport, WorkspaceKind } from "../../../shared/dashboard-protocol";
import { fixtureWorkspace } from "./fixtures";
import { ROUTINE_UPSELL_DELAY, routineUpsell } from "./routine-upsell";

const now = 1_800_000_000_000;
const routine = (id: string, patch: Partial<RoutineReport> = {}): RoutineReport => ({ id, name: id, schedule: "daily", paused: false, nextRunAt: now + 1000, lastRunAt: null, ...patch });
const workspace = (kind: WorkspaceKind, routines: RoutineReport[]) => {
  const detail = fixtureWorkspace("routine-workspace", "My computer", kind, now);
  detail.report!.bots![0]!.routines = routines;
  detail.report!.bots = detail.report!.bots!.slice(0, 1);
  return detail;
};

test("first load records all current routine ids without showing an upsell", () => {
  const result = routineUpsell([workspace("mac", [routine("old"), routine("paused", { paused: true }), routine("manual", { nextRunAt: null })])], null, 0, now);
  expect(result.seen).toEqual(["old", "paused", "manual"]);
  expect(result.next).toBeNull();
});

test("only new scheduled unpaused routines on local workspaces trigger", () => {
  for (const kind of ["mac", "linux", "windows"] as const) {
    const result = routineUpsell([workspace("vps", [routine("server")]), workspace(kind, [routine("old"), routine("paused", { paused: true }), routine("manual", { nextRunAt: null }), routine("new")])], ["old"], 0, now);
    expect(result.next?.routine.id).toBe("new");
    expect(result.next?.workspace.kind).toBe(kind);
    expect(result.seen).not.toContain("server");
    expect(routineUpsell([workspace(kind, [routine("new")])], result.seen, 0, now).next).toBeNull();
  }
});

test("cooldown still records ids and expires at thirty days", () => {
  const details = [workspace("mac", [routine("new")])];
  const hidden = routineUpsell(details, [], now - ROUTINE_UPSELL_DELAY + 1, now);
  expect(hidden.next).toBeNull();
  expect(hidden.seen).toEqual(["new"]);
  expect(routineUpsell(details, [], now - ROUTINE_UPSELL_DELAY, now).next?.routine.id).toBe("new");
});

test("seen ids are deduplicated and capped at five hundred", () => {
  const seen = Array.from({ length: 500 }, (_, i) => String(i));
  const result = routineUpsell([workspace("mac", [routine("0"), routine("new"), routine("new")])], seen, 0, now);
  expect(result.seen).toHaveLength(500);
  expect(result.seen.slice(-2)).toEqual(["0", "new"]);
  expect(result.seen).not.toContain("1");
});
