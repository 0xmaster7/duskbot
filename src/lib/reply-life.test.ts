import { describe, expect, it } from "vitest";

import {
  LIFE_DOTS_MS,
  LIFE_DOTS_STATE,
  LIFE_LOOP_DOTS_MS,
  LIFE_LOOP_MASCOT_MS,
  LIFE_MASCOT_MS,
  LIFE_MASCOT_STATE,
  lifeAt,
  lifeMarkState,
  lifeSpan,
  lifeSpeaks,
} from "./reply-life";
import { replyHidesLine } from "./turn-tail";

const seeds = Array.from({ length: 400 }, (_, index) => `bot:thread:${1_700_000_000_000 + index * 7919}`);

describe("the quiet wait's beats", () => {
  it("opens on the mascot for a seeded 0.9 to 1.8 s, then the dots for 0.6 to 1.4 s", () => {
    for (const seed of seeds) {
      const mascot = lifeSpan(seed, 0), dots = lifeSpan(seed, 1);
      expect(mascot).toBeGreaterThanOrEqual(LIFE_MASCOT_MS.min);
      expect(mascot).toBeLessThanOrEqual(LIFE_MASCOT_MS.max);
      expect(dots).toBeGreaterThanOrEqual(LIFE_DOTS_MS.min);
      expect(dots).toBeLessThanOrEqual(LIFE_DOTS_MS.max);
      expect(lifeAt(seed, 0)).toEqual({ beat: "mascot", nextAtMs: mascot });
      expect(lifeAt(seed, mascot - 1).beat).toBe("mascot");
      expect(lifeAt(seed, mascot)).toEqual({ beat: "dots", nextAtMs: mascot + dots });
    }
  });

  it("draws the same timings for the same turn and different ones across turns", () => {
    expect(lifeSpan(seeds[0]!, 0)).toBe(lifeSpan(seeds[0]!, 0));
    expect(lifeAt(seeds[3]!, 2_500)).toEqual(lifeAt(seeds[3]!, 2_500));
    const firsts = new Set(seeds.map((seed) => lifeSpan(seed, 0)));
    expect(firsts.size, "random per turn, not one fixed beat").toBeGreaterThan(100);
    const spread = [...firsts];
    expect(Math.min(...spread)).toBeLessThan(1_000);
    expect(Math.max(...spread)).toBeGreaterThan(1_700);
  });

  it("keeps drifting between the mascot and the dots on a long wait, never freezing on one", () => {
    for (const seed of seeds.slice(0, 40)) {
      let at = 0;
      for (let index = 0; index < 12; index++) {
        const span = lifeSpan(seed, index);
        expect(lifeAt(seed, at)).toEqual({ beat: index % 2 === 0 ? "mascot" : "dots", nextAtMs: at + span });
        if (index >= 2) {
          const range = index % 2 === 0 ? LIFE_LOOP_MASCOT_MS : LIFE_LOOP_DOTS_MS;
          expect(span).toBeGreaterThanOrEqual(range.min);
          expect(span).toBeLessThanOrEqual(range.max);
        }
        at += span;
      }
    }
  });

  it("still alternates an hour in, in constant work", () => {
    const seed = seeds[9]!;
    const hour = 60 * 60 * 1000;
    const here = lifeAt(seed, hour);
    expect(here.nextAtMs).toBeGreaterThan(hour);
    expect(here.nextAtMs - hour).toBeLessThanOrEqual(Math.max(LIFE_LOOP_MASCOT_MS.max, LIFE_LOOP_DOTS_MS.max));
    const next = lifeAt(seed, here.nextAtMs);
    expect(next.beat).not.toBe(here.beat);
  });
});

describe("skipping ahead", () => {
  it("goes straight to the dots once the reply is being written, from any point of the wait, and holds them", () => {
    for (const seed of seeds.slice(0, 40)) {
      expect(lifeAt(seed, 0).beat).toBe("mascot");
      expect(lifeAt(seed, 0, true)).toEqual({ beat: "dots", nextAtMs: Infinity });
      expect(lifeAt(seed, lifeSpan(seed, 0) / 2, true).beat).toBe("dots");
    }
  });

  it("never holds the reply: the line under it is gone the frame it lands, wherever the beats are", () => {
    // a reply that lands 200 ms into the mascot's beat hides the line at once
    expect(lifeAt(seeds[0]!, 200).beat).toBe("mascot");
    expect(replyHidesLine(0, undefined)).toBe(true);
    expect(replyHidesLine(0, "friendly:chat.typing")).toBe(true);
  });
});

describe("what the mark plays", () => {
  it("lives only through the quiet wait; a named step keeps its own state", () => {
    expect(lifeMarkState("thinking", "mascot")).toBe(LIFE_MASCOT_STATE);
    expect(lifeMarkState("thinking", "dots")).toBe(LIFE_DOTS_STATE);
    expect(lifeMarkState("streaming", "dots")).toBe(LIFE_DOTS_STATE);
    expect(lifeMarkState("thinking", undefined)).toBe("thinking");
    for (const step of ["reading", "searching", "running", "coding", "working", "blocked", "finished"] as const) {
      expect(lifeMarkState(step, "mascot")).toBe(step);
    }
    expect(LIFE_DOTS_STATE, "the dots are the engine's own morph of the mascot").toBe("thinking");
  });
});

describe("the words", () => {
  it("leave about half the quiet waits wordless, the same way for the same turn", () => {
    const speaking = seeds.filter(lifeSpeaks).length;
    expect(speaking).toBeGreaterThan(seeds.length * 0.4);
    expect(speaking).toBeLessThan(seeds.length * 0.6);
    expect(lifeSpeaks(seeds[5]!)).toBe(lifeSpeaks(seeds[5]!));
  });
});
