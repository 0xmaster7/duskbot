import { describe, expect, it } from "vitest";

import { MARK_CLIPS, createAnimator, markClip } from "./mascot-motion-engine";
import { OMB_CLIPS } from "./mascot-clips";
import {
  BLINK_FIRST_MS, BLINK_GAP_MS, DOUBLE_BLINK_GAP_MS, DOZE_AFTER_MS, FIRST_ACT_MS, IDLE_ACTS, IDLE_GAP_MS, PEEK, REACTION_MOVES, createPersona,
  type PersonaBody,
} from "./mascot-personality";

function recorder() {
  const log: string[] = [];
  const looks: Array<{ x: number; y: number } | null> = [];
  const body: PersonaBody = {
    blink: () => log.push("blink"),
    play: (clip) => log.push(`play:${clip.name}`),
    poke: (kind) => log.push(`poke:${kind}`),
    holdFace: (face) => log.push(`face:${face}`),
    look: (gaze) => {
      looks.push(gaze);
      log.push(gaze ? "look" : "look:ahead");
    },
  };
  return { log, looks, body };
}

/** Gaps between idle acts (blinks and a peek's later looks are not acts), stepping the persona on its own schedule and
 * waking it whenever it dozes off; a gap across a wake is left out. */
function actGaps(seed: number, count: number) {
  const persona = createPersona(seed, recorder().body, markClip);
  const gaps: number[] = [];
  let last: number | null = null;
  let at = persona.tick(0, true);
  while (gaps.length < count) {
    const before = persona.acts;
    const next = persona.tick(at, true);
    if (persona.acts !== before) {
      if (last !== null) gaps.push(at - last);
      last = at;
    }
    if (persona.isDozing) {
      persona.touch(at);
      last = null;
    }
    at = next;
  }
  return gaps;
}

describe("persona", () => {
  it("waits a seeded first delay, then keeps gaps between acts in range", () => {
    const { body } = recorder();
    const persona = createPersona(42, body, markClip);
    const first = persona.tick(0, true);
    expect(first).toBeGreaterThanOrEqual(FIRST_ACT_MS.min);
    expect(first).toBeLessThanOrEqual(FIRST_ACT_MS.max);
    for (const gap of actGaps(42, 20)) {
      expect(gap).toBeGreaterThanOrEqual(IDLE_GAP_MS.min);
      expect(gap).toBeLessThanOrEqual(IDLE_GAP_MS.max);
    }
  });

  it("is not periodic: the gaps vary and differ between bots", () => {
    const gaps = (seed: number) => actGaps(seed, 12).map(Math.round);
    const a = gaps(1);
    expect(new Set(a).size).toBeGreaterThan(8);
    expect(gaps(2)).not.toEqual(a);
  });

  it("respects cooldowns and picks rarer acts less often", () => {
    const { log, body } = recorder();
    const persona = createPersona(7, body, markClip);
    let at = persona.tick(0, true);
    const yawns: number[] = [];
    for (let i = 0; i < 400; i++) {
      const before = log.length;
      const next = persona.tick(at, true);
      if (log.slice(before).includes("play:Yawn")) yawns.push(at);
      persona.touch(at);
      at = next;
    }
    for (let i = 1; i < yawns.length; i++) expect(yawns[i]! - yawns[i - 1]!).toBeGreaterThanOrEqual(IDLE_ACTS.yawn.cooldownMs);
    expect(log.filter((entry) => entry === "look").length).toBeGreaterThan(yawns.length);
  });

  it("dozes when untouched and wakes with a little jump when touched", () => {
    const { log, body } = recorder();
    const persona = createPersona(3, body, markClip);
    let at = persona.tick(0, true);
    while (at < DOZE_AFTER_MS.max + 20_000) at = persona.tick(at, true);
    expect(persona.isDozing).toBe(true);
    expect(log).toContain("face:sleepy");
    persona.touch(at);
    expect(persona.isDozing).toBe(false);
    expect(log.slice(-2)).toEqual(["face:null", "play:Wake"]);
  });

  it("stops idling while the mark is busy", () => {
    const { log, body } = recorder();
    const persona = createPersona(5, body, markClip);
    persona.tick(0, true);
    expect(persona.tick(100_000, false)).toBe(Infinity);
    expect(log).toHaveLength(0);
  });

  it("blinks on threebot's clock, one in five a double, apart from the acts", () => {
    const { log, body } = recorder();
    const persona = createPersona(11, body, markClip);
    const blinks: number[] = [];
    let at = persona.blinks(0, true);
    expect(at).toBeGreaterThanOrEqual(BLINK_FIRST_MS.min);
    expect(at).toBeLessThanOrEqual(BLINK_FIRST_MS.max);
    while (blinks.length < 400) {
      const before = log.length;
      const next = persona.blinks(at, true);
      for (let i = before; i < log.length; i++) blinks.push(at);
      at = next;
    }
    expect(log.every((entry) => entry === "blink")).toBe(true);
    const gaps = blinks.slice(1).map((t, i) => t - blinks[i]!);
    const doubles = gaps.filter((gap) => gap === DOUBLE_BLINK_GAP_MS).length;
    for (const gap of gaps) {
      if (gap === DOUBLE_BLINK_GAP_MS) continue;
      expect(gap).toBeGreaterThanOrEqual(BLINK_GAP_MS.min - DOUBLE_BLINK_GAP_MS);
      expect(gap).toBeLessThanOrEqual(BLINK_GAP_MS.max);
    }
    expect(doubles / (blinks.length - doubles)).toBeGreaterThan(0.12);
    expect(doubles / (blinks.length - doubles)).toBeLessThan(0.3);
  });

  it("keeps blinking under a held gaze, but not while dozing or busy", () => {
    const { log, body } = recorder();
    const persona = createPersona(4, body, markClip);
    let at = persona.blinks(0, true);
    at = persona.blinks(at, true);
    expect(log).toContain("blink");
    expect(persona.blinks(at, false)).toBe(Infinity);
    let now = 0;
    persona.tick(now, true);
    while (!persona.isDozing) now = persona.tick(now, true);
    const before = log.filter((entry) => entry === "blink").length;
    for (let t = now; t < now + 30_000; t += 100) persona.blinks(t, true);
    expect(log.filter((entry) => entry === "blink").length).toBe(before);
  });

  it("peeks at a point near ahead, sometimes a second, then looks ahead again", () => {
    const { looks, body } = recorder();
    const persona = createPersona(21, body, markClip);
    let at = persona.tick(0, true);
    for (let i = 0; i < 300; i++) {
      at = persona.tick(at, true);
      if (persona.isDozing) persona.touch(at);
    }
    const spots = looks.filter((gaze) => gaze !== null);
    expect(spots.length).toBeGreaterThan(20);
    for (const gaze of spots) {
      expect(Math.abs(gaze!.x)).toBeGreaterThanOrEqual(PEEK.x[0]);
      expect(Math.abs(gaze!.x)).toBeLessThanOrEqual(PEEK.x[1]);
      expect(gaze!.y).toBeGreaterThanOrEqual(PEEK.y[0]);
      expect(gaze!.y).toBeLessThanOrEqual(PEEK.y[1]);
    }
    expect(looks.at(-1) === null || persona.lastAct === "peek").toBe(true);
    // a touch hands the eyes back at once
    const { looks: held, body: other } = recorder();
    const toucher = createPersona(21, other, markClip);
    let t = toucher.tick(0, true);
    while (!held.some((gaze) => gaze !== null)) t = toucher.tick(t, true);
    toucher.touch(t);
    expect(held.at(-1)).toBeNull();
  });

  it("plays each reaction once inside its cooldown", () => {
    const { log, body } = recorder();
    const persona = createPersona(9, body, markClip);
    persona.react("hop", 0);
    persona.react("hop", 100);
    persona.react("startle", 200);
    persona.react("hop", 900);
    expect(log.filter((entry) => !entry.startsWith("look"))).toHaveLength(3);
    expect(log[1]).toMatch(/^play:(Startle|Wince)$/);
  });

  it("answers the same moment a different way each time, from its own pool", () => {
    const { log, body } = recorder();
    const persona = createPersona(13, body, markClip);
    const moves: string[] = [];
    for (let i = 0; i < 40; i++) {
      const before = log.length;
      persona.react("cheer", i * 1_000);
      moves.push(log.slice(before).filter((entry) => !entry.startsWith("look")).join("+"));
    }
    for (let i = 1; i < moves.length; i++) expect(moves[i]).not.toBe(moves[i - 1]);
    expect(new Set(moves).size).toBe(REACTION_MOVES.cheer.length);
    // two bots answer the same cue differently
    const other = recorder();
    const second = createPersona(14, other.body, markClip);
    for (let i = 0; i < 40; i++) second.react("cheer", i * 1_000);
    expect(other.log.join()).not.toBe(log.join());
  });

  it("never plays the same idle act twice running", () => {
    const { body } = recorder();
    const persona = createPersona(17, body, markClip);
    const acts: string[] = [];
    let at = persona.tick(0, true);
    while (acts.length < 120) {
      const before = persona.acts;
      at = persona.tick(at, true);
      if (persona.acts !== before) acts.push(persona.lastAct!);
      if (persona.isDozing) persona.touch(at);
    }
    for (let i = 1; i < acts.length; i++) expect(acts[i]).not.toBe(acts[i - 1]);
    expect(new Set(acts).size).toBeGreaterThan(7);
  });
});

describe("clips", () => {
  it("has every one of grok's 28 clips", () => {
    expect([...MARK_CLIPS.keys()].sort()).toEqual([
      "Blocked_A", "Blocked_B", "Blocked_C", "Bodymoves_A", "Done_A", "Done_B", "Done_C", "Idle_A", "Idle_B", "Idle_D",
      "Logo_A", "Logo_B", "Marketing_A", "Marketing_B", "Marketing_C", "Marketing_D", "Rotation_A", "Rotation_B",
      "Rotation_C", "Streaming_A", "Streaming_B", "Streaming_C", "Working_A", "Working_B", "Working_C", "Working_D",
      "Working_E", "Working_F",
    ]);
  });

  it("plays each of our clips through grok's animator and moves the body", () => {
    for (const clip of Object.values(OMB_CLIPS)) {
      const animator = createAnimator({ body: "blob" });
      const rest = JSON.stringify(animator.frame());
      animator.load(clip, { isPlaying: true });
      const seen = new Set<string>();
      for (let i = 0; i < Math.ceil(clip.duration * 30); i++) {
        animator.advance(1 / 30);
        seen.add(JSON.stringify(animator.frame()));
      }
      expect(seen.size, clip.name).toBeGreaterThan(5);
      expect(seen.has(rest) && seen.size === 1, clip.name).toBe(false);
    }
  });
});
