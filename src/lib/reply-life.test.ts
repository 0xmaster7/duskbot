import { describe, expect, it } from "vitest";

import { LIFE_DOTS_MS, LIFE_DOTS_STATE, LIFE_MASCOT_MS, LIFE_MASCOT_STATE, lifeAt, lifeMarkState, lifeSpan } from "./reply-life";

const seeds = Array.from({ length: 400 }, (_, index) => `bot:thread:${1_700_000_000_000 + index * 7919}`);

describe("the start of a turn's beats", () => {
  it("mounts as the mascot for a seeded 430 to 600 ms, then one pass of the dots for 400 to 700 ms", () => {
    for (const seed of seeds) {
      const mascot = lifeSpan(seed, 0), dots = lifeSpan(seed, 1);
      expect(mascot).toBeGreaterThanOrEqual(LIFE_MASCOT_MS.min);
      expect(mascot).toBeLessThanOrEqual(LIFE_MASCOT_MS.max);
      expect(dots).toBeGreaterThanOrEqual(LIFE_DOTS_MS.min);
      expect(dots).toBeLessThanOrEqual(LIFE_DOTS_MS.max);
      expect(lifeAt(seed, 0)).toEqual({ beat: "mascot", nextAtMs: mascot });
      expect(lifeAt(seed, mascot)).toEqual({ beat: "dots", nextAtMs: mascot + dots });
    }
  });

  it("morphs back to the mascot after the dots and stays, never looping", () => {
    for (const seed of seeds.slice(0, 40)) {
      const back = lifeSpan(seed, 0) + lifeSpan(seed, 1);
      expect(lifeAt(seed, back)).toEqual({ beat: "mascot", nextAtMs: Infinity });
      expect(lifeAt(seed, 60 * 60 * 1000)).toEqual({ beat: "mascot", nextAtMs: Infinity });
    }
  });

  it("draws the same timings for the same turn and different ones across turns", () => {
    expect(lifeAt(seeds[3]!, 700)).toEqual(lifeAt(seeds[3]!, 700));
    expect(new Set(seeds.map((seed) => lifeSpan(seed, 0))).size).toBeGreaterThan(100);
  });

  it("is the bot itself, never the dots, while its reply is being written", () => {
    for (const seed of seeds.slice(0, 40)) {
      expect(lifeAt(seed, lifeSpan(seed, 0) + 1, true)).toEqual({ beat: "mascot", nextAtMs: Infinity });
    }
  });
});

describe("what the mark plays", () => {
  it("lives only through the quiet wait; a named step keeps its own state", () => {
    expect(lifeMarkState("thinking", "mascot")).toBe(LIFE_MASCOT_STATE);
    expect(lifeMarkState("thinking", "dots")).toBe(LIFE_DOTS_STATE);
    expect(lifeMarkState("thinking", undefined)).toBe("thinking");
    for (const step of ["reading", "searching", "running", "coding", "working", "blocked", "finished"] as const) {
      expect(lifeMarkState(step, "mascot")).toBe(step);
    }
    expect(LIFE_DOTS_STATE, "the dots are the engine's own morph of the mascot").toBe("thinking");
  });
});
