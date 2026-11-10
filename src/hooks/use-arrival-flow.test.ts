// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { ROW_ENTER_EASE, ROW_ENTER_MS, ROW_RISE_PX, useArrivalFlow } from "./use-arrival-flow";

// happy-dom has no layout: each element reports the offsets the test gives it, and animations are recorded
type Recorded = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let recorded: Recorded[] = [];
let finishers: (() => void)[] = [];
const fakeAnimation = () => ({ playState: "running", effect: { getComputedTiming: () => ({ progress: 0 }) }, cancel: vi.fn(), addEventListener: (_type: string, listener: () => void) => finishers.push(listener) });

function place(el: HTMLElement, top: number, parent: HTMLElement) {
  Object.defineProperty(el, "offsetTop", { configurable: true, get: () => top });
  Object.defineProperty(el, "offsetParent", { configurable: true, get: () => parent });
}

let root: Root;
let scroller: HTMLDivElement, clip: HTMLDivElement, column: HTMLDivElement, slot: HTMLDivElement;
let scrollHeight = 1000;
const CLIENT = 600;

function Probe({ following, n, thread = "t" }: { following: boolean; n: number; thread?: string }) {
  useArrivalFlow({ scrollRef: { current: scroller }, clipRef: { current: clip }, columnRef: { current: column }, transcriptKey: thread, following });
  return createElement("span", null, n);
}
const draw = (following: boolean, n: number, thread?: string) => act(() => root.render(createElement(Probe, { following, n, thread })));

function addRow(top: number, arrival?: "start" | "end") {
  const row = document.createElement("div");
  row.setAttribute("data-message-row", "");
  if (arrival) row.setAttribute("data-arrival", arrival);
  place(row, top, column);
  column.insertBefore(row, slot);
  return row;
}
const moved = (el: Element) => recorded.filter((r) => r.el === el && String(r.keyframes[0]?.transform ?? "").startsWith("translateY"));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  recorded = [];
  finishers = [];
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (this: HTMLElement, keyframes, options) {
    recorded.push({ el: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions });
    return fakeAnimation() as unknown as Animation;
  });
  scroller = document.createElement("div");
  clip = document.createElement("div");
  column = document.createElement("div");
  slot = document.createElement("div");
  slot.className = "turn-status-slot";
  scroller.append(clip);
  clip.append(column);
  column.append(slot);
  document.body.append(scroller);
  scrollHeight = 1000;
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => CLIENT });
  scroller.scrollTop = scrollHeight - CLIENT;
  addRow(800);
  place(slot, 900, column);
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  scroller.remove();
  vi.restoreAllMocks();
});

describe("useArrivalFlow", () => {
  const rises = (el: Element) => recorded.filter((r) => r.el === el);

  it("puts a bot's reply on screen whole, rising 12px over 240ms at full opacity, with the view at its end at once", () => {
    draw(true, 0);
    const reply = addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(0);
    const [entrance] = rises(reply);
    expect(entrance?.keyframes).toEqual([{ transform: `translateY(${ROW_RISE_PX}px)` }, { transform: "translateY(0px)" }]);
    expect(entrance?.options).toEqual({ duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE });
    expect(ROW_RISE_PX).toBe(12);
    expect(ROW_ENTER_MS).toBe(240);
    expect(ROW_ENTER_EASE).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
    // no fade, no clip reveal, and the status line is left alone
    expect(entrance?.keyframes.every((frame) => frame.opacity === undefined && frame.clipPath === undefined)).toBe(true);
    expect(rises(slot)).toHaveLength(0);
  });

  it("gives the person's own bubble the same entrance, and clips the column only while it rises", () => {
    draw(true, 0);
    const mine = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(0);
    expect(rises(mine)[0]?.keyframes[0]?.transform).toBe(`translateY(${ROW_RISE_PX}px)`);
    expect(rises(mine)[0]?.options).toEqual({ duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE });
    expect(clip.style.overflowY).toBe("clip");
    act(() => finishers.forEach((finish) => finish()));
    expect(clip.style.overflowY).toBe("");
  });

  it("gives every row in one batch its own entrance, with no stagger", () => {
    draw(true, 0);
    const file = addRow(900, "start");
    const summary = addRow(970, "start");
    place(slot, 1040, column);
    scrollHeight = 1140;
    draw(true, 1);
    expect(rises(file)[0]?.options).toEqual({ duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE });
    expect(rises(summary)[0]?.options).toEqual({ duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE });
  });

  it("keeps the end pinned in the frame the composer changes height, with no glide", () => {
    draw(true, 0);
    addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);
    // the composer's pad grows by 40px under a transcript resting at its end
    scrollHeight = 1096;
    draw(true, 2);
    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(0);
  });

  it("moves nothing on screen for a reader scrolled up", () => {
    draw(false, 0);
    scroller.scrollTop = 100;
    addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(false, 1);

    expect(scroller.scrollTop).toBe(100);
    expect(moved(column)).toHaveLength(0);
    expect(clip.style.overflowY).toBe("");
  });

  it("lands history in place: rows that are not live arrivals never move the transcript", () => {
    draw(true, 0);
    // a thread's snapshot (or a cached tail catching up) appends rows with no arrival mark
    addRow(900);
    addRow(960);
    place(slot, 1020, column);
    scrollHeight = 1120;
    draw(true, 1);

    expect(recorded).toHaveLength(0);
    expect(clip.style.overflowY).toBe("");
  });

  it("opens another conversation without motion, even when its rows are marked fresh", () => {
    draw(true, 0);
    addRow(900, "start");
    scrollHeight = 3000;
    draw(true, 1, "other");
    expect(recorded).toHaveLength(0);
  });

  it("plays a row's entrance once, however often the transcript renders", () => {
    draw(true, 0);
    const reply = addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(true, 1);
    const count = recorded.filter((r) => r.el === reply).length;
    draw(true, 2);
    draw(true, 3);
    expect(recorded.filter((r) => r.el === reply)).toHaveLength(count);
  });
});
