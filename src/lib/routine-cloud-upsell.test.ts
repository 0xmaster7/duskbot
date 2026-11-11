import { describe, expect, it } from "vitest";
import { madeSince, newRoutineSinceBaseline } from "./routine-cloud-upsell";

describe("new routines since the first non-empty baseline", () => {
  const routine = (id: string, enabled = true) => ({ id, enabled });

  it("waits through empty hydration and never reacts to the baseline", () => {
    expect(newRoutineSinceBaseline(null, [])).toEqual({ seen: null, created: null });
    const baseline = newRoutineSinceBaseline(null, [routine("existing")]);
    expect(baseline.created).toBeNull();
    expect(baseline.seen).toEqual(new Set(["existing"]));
  });

  it("detects a new enabled id from patches or hydration, once", () => {
    const baseline = newRoutineSinceBaseline(null, [routine("existing")]);
    const created = routine("new");
    const next = newRoutineSinceBaseline(baseline.seen, [created, routine("existing")]);
    expect(next.created).toBe(created);
    expect(newRoutineSinceBaseline(next.seen, [{ ...created, name: "renamed" }]).created).toBeNull();
    const removed = newRoutineSinceBaseline(next.seen, []);
    expect(newRoutineSinceBaseline(removed.seen, [created]).created).toBeNull();
  });

  it("remembers disabled and automatically paused ids without promoting them", () => {
    const baseline = new Set(["existing"]);
    const next = newRoutineSinceBaseline(baseline, [routine("disabled", false), { ...routine("held"), heldFor: "no_engine" as const }]);
    expect(next.created).toBeNull();
    expect(newRoutineSinceBaseline(next.seen, [routine("disabled"), routine("held")]).created).toBeNull();
  });
});

describe("what was made since the window opened", () => {
  it("keeps only what was created from then on, so the first routine ever counts and late lists never do", () => {
    const old = { id: "old", createdAt: 100 }, fresh = { id: "fresh", createdAt: 200 };
    expect(madeSince([old, fresh], 150)).toEqual([fresh]);
    expect(newRoutineSinceBaseline(new Set(), madeSince([{ ...fresh, enabled: true }], 150).map(entry => entry)).created?.id).toBe("fresh");
  });
});
