import { describe, expect, it } from "vitest";

import { MARK_CLIPS, createAnimator, markClip } from "./mascot-motion-engine";
import { OMB_CLIPS } from "./mascot-clips";
import { DOZE_AFTER_MS, FIRST_ACT_MS, IDLE_ACTS, IDLE_GAP_MS, createPersona, type PersonaBody } from "./mascot-personality";

function recorder() {
  const log: string[] = [];
  const body: PersonaBody = {
    blink: () => log.push("blink"),
    play: (clip) => log.push(`play:${clip.name}`),
    poke: (kind) => log.push(`poke:${kind}`),
    holdFace: (face) => log.push(`face:${face}`),
  };
  return { log, body };
}

describe("persona", () => {
  it("waits a seeded first delay, then keeps gaps between acts in range", () => {
    const { body } = recorder();
    const persona = createPersona(42, body, markClip);
    const first = persona.tick(0, true);
    expect(first).toBeGreaterThanOrEqual(FIRST_ACT_MS.min);
    expect(first).toBeLessThanOrEqual(FIRST_ACT_MS.max);
    let at = first;
    for (let i = 0; i < 20; i++) {
      const next = persona.tick(at, true);
      expect(next - at).toBeGreaterThanOrEqual(IDLE_GAP_MS.min);
      expect(next - at).toBeLessThanOrEqual(IDLE_GAP_MS.max);
      at = next;
    }
  });

  it("is not periodic: the gaps vary and differ between bots", () => {
    const gaps = (seed: number) => {
      const persona = createPersona(seed, recorder().body, markClip);
      let at = persona.tick(0, true);
      const out: number[] = [];
      for (let i = 0; i < 12; i++) { const next = persona.tick(at, true); out.push(Math.round(next - at)); at = next; }
      return out;
    };
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
    expect(log.filter((entry) => entry === "blink").length).toBeGreaterThan(yawns.length);
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

  it("plays each reaction once inside its cooldown", () => {
    const { log, body } = recorder();
    const persona = createPersona(9, body, markClip);
    persona.react("hop", 0);
    persona.react("hop", 100);
    persona.react("startle", 200);
    persona.react("hop", 900);
    expect(log).toEqual(["play:Hop", "play:Startle", "play:Hop"]);
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
