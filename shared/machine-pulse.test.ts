import { describe, expect, it } from "vitest";
import { PULSE_SIZE, PulseRing, parsePulse } from "./machine-pulse.ts";

const at = (t: number, cpu = t) => ({ t, cpu, mem: 50 });

describe("pulse ring", () => {
  it("keeps the newest samples up to its size, oldest first", () => {
    const ring = new PulseRing(4);
    for (let t = 1; t <= 6; t++) ring.push(at(t));
    expect(ring.length).toBe(4);
    expect(ring.since().map(s => s.t)).toEqual([3, 4, 5, 6]);
    expect(ring.last()).toEqual(at(6));
  });
  it("only moves forward in time", () => {
    const ring = new PulseRing(4);
    expect(ring.push(at(5))).toBe(true);
    expect(ring.push(at(5, 9))).toBe(false);
    expect(ring.push(at(3))).toBe(false);
    expect(ring.since()).toEqual([at(5)]);
  });
  it("answers what came after a time, and clears", () => {
    const ring = new PulseRing();
    for (let t = 1; t <= PULSE_SIZE + 10; t++) ring.push(at(t));
    expect(ring.since(PULSE_SIZE + 7).map(s => s.t)).toEqual([PULSE_SIZE + 8, PULSE_SIZE + 9, PULSE_SIZE + 10]);
    expect(ring.since(0)).toHaveLength(PULSE_SIZE);
    ring.clear();
    expect(ring.since()).toEqual([]);
    expect(ring.last()).toBeNull();
  });
});

describe("parsePulse", () => {
  it("clamps percents, drops bad samples, sorts and bounds the list", () => {
    expect(parsePulse("nope")).toBeNull();
    expect(parsePulse([{ t: 2, cpu: 130, mem: -1 }, { t: 1, cpu: 12.345, mem: 40 }, { t: 0, cpu: 1, mem: 1 }, { t: 3, cpu: "x", mem: 1 }, null]))
      .toEqual([{ t: 1, cpu: 12.3, mem: 40 }, { t: 2, cpu: 100, mem: 0 }]);
    expect(parsePulse(Array.from({ length: PULSE_SIZE * 3 }, (_, i) => at(i + 1)))).toHaveLength(PULSE_SIZE);
  });
});
