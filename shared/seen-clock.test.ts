import { describe, expect, it } from "vitest";
import { seenTimer, upsellClock, type Visibility } from "./seen-clock.ts";

function page() {
  const listeners = new Set<() => void>();
  const doc: Visibility & { set(state: string): void; count(): number } = {
    visibilityState: "visible",
    addEventListener: (_type, fn) => { listeners.add(fn); },
    removeEventListener: (_type, fn) => { listeners.delete(fn); },
    set(state) { this.visibilityState = state; listeners.forEach(fn => fn()); },
    count: () => listeners.size,
  };
  return doc;
}

describe("seen clock", () => {
  it("counts only visible, unpaused time and stops listening when stopped", () => {
    let now = 0;
    const doc = page(), timer = seenTimer(doc, () => now);
    now = 3_000; doc.set("hidden");
    now = 60_000; doc.set("visible");
    now = 61_000; timer.pause();
    now = 90_000; timer.resume();
    now = 92_000;
    expect(timer.ms()).toBe(6_000);
    expect(timer.stop()).toBe(6_000);
    expect(doc.count()).toBe(0);
    now = 99_000;
    expect(timer.stop()).toBe(6_000);
  });

  it("reports an upsell's outcome with its visible time, once, and survives a strict remount", () => {
    let now = 0;
    const sent: Array<[string, string, number | null]> = [], later: Array<() => void> = [];
    const clock = upsellClock((name, source, ms) => sent.push([name, source, ms]), { doc: page(), now: () => now, defer: fn => later.push(fn) });
    clock.report("shown", "dash_sidebar");
    clock.report("shown", "dash_sidebar");
    let stop = clock.watch("dash_sidebar");
    stop(); stop = clock.watch("dash_sidebar");
    later.splice(0).forEach(fn => fn());
    now = 4_000;
    clock.report("dismiss", "dash_sidebar");
    stop(); later.splice(0).forEach(fn => fn());
    clock.report("shown", "dash_routines");
    stop = clock.watch("dash_routines");
    now = 34_000;
    stop(); later.splice(0).forEach(fn => fn());
    clock.report("shown", "app_mobile");
    now = 35_000;
    clock.leave();
    expect(sent).toEqual([["upsell_shown", "dash_sidebar", null], ["upsell_dismiss", "dash_sidebar", 4_000], ["upsell_shown", "dash_routines", null],
      ["upsell_ignored", "dash_routines", 30_000], ["upsell_shown", "app_mobile", null], ["upsell_ignored", "app_mobile", 1_000]]);
  });
});
