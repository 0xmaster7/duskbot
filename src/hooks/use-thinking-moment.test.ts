// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarkReaction } from "@/components/mascot-personality";
import { STATUS_QUIET_MS } from "@/components/TurnPresence";
import { LAST_BEAT_MS, THINKING_MOMENTS, pickThinkingMoment, useThinkingMoment } from "./use-thinking-moment";

let root: Root;
const reacted: MarkReaction[] = [];
const mark = { current: { react: (kind: MarkReaction) => void reacted.push(kind) } };
function Probe({ thinking }: { thinking: boolean }) {
  useThinkingMoment(mark, thinking);
  return null;
}
const draw = (thinking: boolean) => act(() => root.render(createElement(Probe, { thinking })));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  reacted.length = 0;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useThinkingMoment", () => {
  it("plays one moment's beats in order, all before the words come in", () => {
    draw(true);
    act(() => void vi.advanceTimersByTime(LAST_BEAT_MS + 50));
    expect(reacted.length).toBeGreaterThan(0);
    expect(THINKING_MOMENTS.some((moment) => moment.map((beat) => beat.react).join() === reacted.join())).toBe(true);
    // every beat starts inside the quiet stretch, while the mark is alone on the line
    expect(LAST_BEAT_MS).toBeLessThan(STATUS_QUIET_MS.min + 200);
  });

  it("stops when the reply lands first", () => {
    draw(true);
    act(() => void vi.advanceTimersByTime(200));
    const first = reacted.length;
    draw(false);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(reacted).toHaveLength(first);
  });

  it("never plays the same moment twice running, and jitters its later beats", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const picks = Array.from({ length: 60 }, () => pickThinkingMoment(random));
    const names = picks.map((beats) => beats.map((beat) => beat.react).join());
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]);
    expect(new Set(names).size).toBe(THINKING_MOMENTS.length);
    const late = picks.filter((beats) => beats.length > 1).map((beats) => beats.at(-1)!.at);
    expect(new Set(late).size).toBeGreaterThan(5);
    expect(Math.max(...picks.flat().map((beat) => beat.at))).toBeLessThanOrEqual(LAST_BEAT_MS);
  });
});
