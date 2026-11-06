import { describe, expect, it } from "vitest";

import { markClip } from "./mascot-motion-engine";
import { CLICK, CLICK_MOVES, clickTaste, createClickReactor, type ClickBody } from "./mascot-click";
import { createPersona, type PersonaBody } from "./mascot-personality";

function recorder() {
  const log: string[] = [];
  const body: ClickBody & PersonaBody = {
    blink: () => log.push("blink"),
    play: (clip) => log.push(`play:${clip.name}`),
    poke: (kind, turns = 1) => log.push(turns > 1 ? `poke:${kind}x${turns}` : `poke:${kind}`),
    peek: () => log.push("peek"),
    holdFace: (face) => log.push(`face:${face}`),
    look: (gaze) => log.push(gaze ? "look" : "look:ahead"),
  };
  return { log, body };
}

/** Clicks far enough apart that none escalates. */
function opens(seed: number, count: number) {
  const reactor = createClickReactor(seed, recorder().body);
  return Array.from({ length: count }, (_, i) => reactor.react("open", i * 10_000, false));
}

describe("click reactions", () => {
  it("never answers two clicks in a row the same way, and uses most of the pool", () => {
    const moves = opens(7, 200);
    for (let i = 1; i < moves.length; i++) expect(moves[i]).not.toBe(moves[i - 1]);
    expect(new Set(moves).size).toBeGreaterThanOrEqual(Object.keys(CLICK_MOVES).length - 1);
  });

  it("is mostly not the happy greet any more, and quiet about a third of the time", () => {
    const moves = Array.from({ length: 40 }, (_, seed) => opens(seed * 7919, 100)).flat();
    const happy = moves.filter((move) => move === "greet" || move === "hop" || move === "wiggle").length;
    expect(happy / moves.length).toBeLessThan(0.2);
    const quiet = moves.filter((move) => CLICK_MOVES[move as keyof typeof CLICK_MOVES]?.subtle).length / moves.length;
    expect(quiet).toBeGreaterThan(0.15);
    expect(quiet).toBeLessThan(0.6);
  });

  it("gives every bot its own leaning, the same each time", () => {
    expect(clickTaste(3)).toEqual(clickTaste(3));
    const favourites = new Set(Array.from({ length: 12 }, (_, seed) => clickTaste(seed).favourites.join()));
    expect(favourites.size).toBeGreaterThan(6);
    expect(opens(1, 30)).not.toEqual(opens(2, 30));
    expect(opens(5, 30)).toEqual(opens(5, 30));
  });

  it("escalates quick repeats with stacking pokes instead of restarting a clip", () => {
    const { log, body } = recorder();
    const reactor = createClickReactor(21, body);
    const answers = [0, 400, 800, 1_200, 1_600, 2_000].map((at) => reactor.react("open", at, false));
    expect(answers[2]).toBe("twirl");
    expect(answers[3]).toBe("dizzy");
    expect(answers[4]).toMatch(/^poke:(nod|bounce)$/);
    expect(answers[5]).toMatch(/^poke:(nod|bounce)$/);
    expect(answers[5]).not.toBe(answers[4]);
    expect(log).toContain("poke:spinx2");
    // past the streak window it starts over
    expect(reactor.react("open", 2_000 + CLICK.streakMs + 1, false)).not.toMatch(/^(twirl|dizzy|poke:)/);
    expect(reactor.streak).toBe(0);
  });

  it("treats a select and the cue right behind it as one click", () => {
    const { log, body } = recorder();
    const persona = createPersona(4, body, markClip);
    persona.react("open", 1_000);
    const after = log.length;
    persona.react("open", 1_000 + CLICK.echoMs - 1);
    expect(log.length).toBe(after);
  });

  it("stretches awake when clicked while dozing", () => {
    const { log, body } = recorder();
    const persona = createPersona(8, body, markClip);
    let at = persona.tick(0, true);
    while (!persona.isDozing) at = persona.tick(at, true);
    persona.react("open", at + 10);
    expect(log).toContain("play:SleepyStretch");
    expect(log).not.toContain("play:Wake");
    expect(persona.lastAct).toBe("stretch");
    expect(persona.isDozing).toBe(false);
  });

  it("leans a double-click on the mark toward grok's tap pokes", () => {
    const reactor = createClickReactor(30, recorder().body);
    const taps = Array.from({ length: 300 }, (_, i) => reactor.react("tap", i * 10_000, false));
    const grok = taps.filter((move) => move === "spin" || move === "bounce" || move === "nod").length / taps.length;
    const opened = opens(30, 300).filter((move) => move === "spin" || move === "bounce" || move === "nod").length / 300;
    expect(grok).toBeGreaterThan(opened);
  });
});
