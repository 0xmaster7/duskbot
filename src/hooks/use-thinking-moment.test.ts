// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarkReaction } from "@/components/mascot-personality";
import { STATUS_QUIET_MS } from "@/components/TurnPresence";
import { THINKING_BEATS, useThinkingMoment } from "./use-thinking-moment";

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
  it("hops as the line appears, then looks around before the words come in", () => {
    draw(true);
    act(() => void vi.advanceTimersByTime(130));
    expect(reacted).toEqual(["hop"]);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(reacted).toEqual(["hop", "lookAround"]);
    // every beat starts inside the quiet stretch, while the mark is alone on the line
    expect(THINKING_BEATS.every((beat) => beat.at < STATUS_QUIET_MS.min + 200)).toBe(true);
  });

  it("stops when the reply lands first", () => {
    draw(true);
    act(() => void vi.advanceTimersByTime(130));
    draw(false);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(reacted).toEqual(["hop"]);
  });
});
