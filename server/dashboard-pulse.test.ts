import { describe, expect, it } from "vitest";
import { createPulseSampler } from "./dashboard-pulse.ts";

describe("pulse sampler", () => {
  it("reads cpu as the change since its own last read and memory as a share of the total", () => {
    let t = 1000, total = 0, idle = 0;
    const sampler = createPulseSampler({ now: () => t, size: 3, read: () => ({ cpu: { total, idle }, memoryUsed: 2, memoryTotal: 8 }) });
    sampler.tick();
    expect(sampler.since(0)).toEqual([]);
    for (const busy of [25, 50, 75, 100]) { t += 3000; total += 100; idle += 100 - busy; sampler.tick(); }
    expect(sampler.since(0)).toEqual([{ t: 7000, cpu: 50, mem: 25 }, { t: 10_000, cpu: 75, mem: 25 }, { t: 13_000, cpu: 100, mem: 25 }]);
    expect(sampler.since(10_000)).toEqual([{ t: 13_000, cpu: 100, mem: 25 }]);
  });
});
