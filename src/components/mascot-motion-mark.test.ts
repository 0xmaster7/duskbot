// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { IDLE_SETTLE_MS, MARK_STATES, SETTLED_HOLD_MS, createMark, hoverGaze, markSeed, prewarmMarkShapes, type MarkOptions } from "./mascot-motion-mark";

function rig(overrides: Partial<MarkOptions> = {}) {
  let now = 0;
  let due = Infinity;
  let frame: ((t: number) => number) | null = null;
  let draws = 0;
  let frames = 0;
  const clock = {
    add(f: (t: number) => number) {
      frame = f;
      due = -Infinity;
      return { wake: (by = -Infinity) => { due = Math.min(due, by); }, remove: () => { frame = null; } };
    },
    pending: () => 0,
  };
  const mark = createMark({
    id: "m", seed: "Koder", body: "blob", ink: "#8f59f9", state: "idle", sizePx: 36,
    isLive: true, isPlaying: true, isEmphasized: false, isReducedMotion: false, ...overrides,
  }, { clock, now: () => now });
  const canvas = document.createElement("span");
  const host = document.createElement("span");
  host.append(canvas);
  mark.attach(canvas, host);
  const run = (ms: number) => {
    for (const end = now + ms; now < end;) {
      now += 1000 / 60;
      if (frame && due <= now + 4) {
        const before = canvas.innerHTML;
        due = frame(now);
        if (due !== Infinity) frames++;
        if (canvas.innerHTML !== before) draws++;
      }
    }
  };
  return { mark, canvas, run, draws: () => draws, frames: () => frames, due: () => due, now: () => now };
}

describe("grok mark controller", () => {
  it("knows grok's own states, ours included", () => {
    for (const state of ["idle", "working", "streaming", "blocked", "finished", "failed", "thinking", "listening", "waiting"]) {
      expect(MARK_STATES).toContain(state);
    }
  });

  it("seeds each bot with FNV-1a of its id, as grok does", () => {
    expect(markSeed("")).toBe(2166136261);
    expect(markSeed("a")).toBe(0xe40c292c);
  });

  it("draws an idle mark at rest and then sleeps", () => {
    const r = rig();
    expect(r.canvas.querySelector("svg")).not.toBeNull();
    r.run(1000);
    expect(r.mark.isSleeping).toBe(true);
    expect(r.due()).toBe(Infinity);
  });

  it("plays a busy state at 30 frames a second", () => {
    const r = rig({ state: "working" });
    r.run(2000);
    expect(r.frames()).toBeGreaterThanOrEqual(59);
    expect(r.frames()).toBeLessThanOrEqual(61);
    expect(r.draws()).toBeGreaterThan(40);
    expect(r.mark.isSleeping).toBe(false);
  });

  it("keeps playing 1.4 s after the turn ends, then rests", () => {
    const r = rig({ state: "working" });
    r.run(1000);
    r.mark.update({ state: "idle" });
    r.run(IDLE_SETTLE_MS - 100);
    expect(r.mark.isSleeping).toBe(false);
    r.run(1500);
    expect(r.mark.isSleeping).toBe(true);
  });

  it("shows finished for 8 s before it rests", () => {
    const r = rig({ state: "finished" });
    r.run(SETTLED_HOLD_MS);
    expect(r.mark.isSleeping).toBe(false);
    r.run(IDLE_SETTLE_MS + 1500);
    expect(r.mark.isSleeping).toBe(true);
  });

  it("never schedules a frame when static or under reduced motion", () => {
    for (const r of [rig({ isLive: false, state: "working" }), rig({ isReducedMotion: true, state: "working" })]) {
      r.run(1000);
      expect(r.draws()).toBe(0);
      expect(r.canvas.querySelector("svg")).not.toBeNull();
    }
  });

  it("wakes a resting mark for hover gaze, then sleeps again", () => {
    const r = rig();
    r.run(500);
    const rest = r.canvas.innerHTML;
    r.mark.gaze({ x: 1, y: 0 });
    r.run(1000);
    expect(r.canvas.innerHTML).not.toBe(rest);
    expect(r.mark.isSleeping).toBe(true);
    r.mark.gaze(null);
    r.run(1500);
    expect(r.canvas.innerHTML).toBe(rest);
  });

  it("measures hover gaze against half the mark's width, y down", () => {
    const rect = { left: 0, top: 0, width: 36, height: 36 };
    expect(hoverGaze(rect, 18 + 9, 18).x).toBe(0.5);
    expect(hoverGaze(rect, 18, 18 + 9).y).toBe(0.5);
    expect(hoverGaze(rect, 100, 100)).toEqual({ x: 1, y: 1 });
  });
});

describe("prewarmMarkShapes", () => {
  it("builds bodies in idle slices, stops while a slice is short, and never queues a shape twice", () => {
    const slices: Array<(deadline: { timeRemaining(): number }) => void> = [];
    const idle = { request: (callback: (deadline: { timeRemaining(): number }) => void) => void slices.push(callback) };
    prewarmMarkShapes(["blob", "flower", "fruit", "blob"], 40, idle);
    expect(slices).toHaveLength(1);
    slices.shift()!({ timeRemaining: () => 0 });
    expect(slices).toHaveLength(1);
    let left = 3;
    slices.shift()!({ timeRemaining: () => (left-- > 0 ? 50 : 0) });
    expect(slices).toHaveLength(0);
    prewarmMarkShapes(["flower", "fruit"], 40, idle);
    expect(slices).toHaveLength(0);
  });

  it("turns a static mark that goes live on hover toward the gaze, as a sidebar row does", () => {
    const r = rig({ isLive: false, isPlaying: false });
    const rest = r.canvas.innerHTML;
    r.mark.update({ isLive: true, isPlaying: true });
    r.mark.gaze({ x: 0.8, y: -0.3 });
    r.run(800);
    expect(r.canvas.innerHTML).not.toBe(rest);
  });

  it("answers emphasis and pokes on a busy status-line mark", () => {
    const quiet = rig({ state: "running", sizePx: 28 });
    const loud = rig({ state: "running", sizePx: 28 });
    loud.mark.update({ isEmphasized: true });
    let differs = 0;
    for (let i = 0; i < 30; i++) {
      quiet.run(100);
      loud.run(100);
      if (loud.canvas.innerHTML !== quiet.canvas.innerHTML) differs++;
    }
    expect(differs).toBeGreaterThan(0);
    const poked = rig({ state: "running", sizePx: 28 });
    poked.mark.poke("spin");
    poked.run(600);
    expect(poked.canvas.innerHTML).not.toBe(quiet.canvas.innerHTML);
  });
});
