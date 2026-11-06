// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleTiming, useArrivalFlow } from "./use-arrival-flow";

// happy-dom has no layout: each element reports the offsets the test gives it, and animations are recorded
type Recorded = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let recorded: Recorded[] = [];
const fakeAnimation = () => ({ playState: "running", effect: { getComputedTiming: () => ({ progress: 0 }) }, cancel: vi.fn(), addEventListener: vi.fn() });

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
  it("samples the settle spring into one linear() curve that lands exactly", () => {
    const { duration, easing } = settleTiming();
    expect(duration).toBeGreaterThan(250);
    expect(duration).toBeLessThan(900);
    expect(easing.startsWith("linear(0, ")).toBe(true);
    expect(easing.endsWith(", 1)")).toBe(true);
    const points = easing.slice(7, -1).split(", ").map(Number);
    expect(Math.max(...points)).toBeLessThan(1.01);
  });

  it("puts a bot's reply on screen at once: the transcript is at its end in the same frame, nothing glides", () => {
    draw(true, 0);
    // a 60px bubble lands above the slot
    const reply = addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(0);
    expect(moved(slot)).toHaveLength(0);
    expect(clip.style.overflowY).toBe("");
    // a quick pop: opacity and a tiny scale, no blur, well under 200ms
    const pop = recorded.find((r) => r.el === reply);
    expect(pop?.keyframes[0]).toMatchObject({ opacity: 0, transform: "scale(0.96)" });
    expect(pop?.keyframes[0]?.filter).toBeUndefined();
    expect(Number(pop?.options.duration)).toBeLessThanOrEqual(160);
    // the status line gives way fast, on opacity alone
    const line = recorded.find((r) => r.el === slot);
    expect(line?.keyframes[1]?.opacity).toBe(0);
    expect(line?.keyframes.every((frame) => frame.transform === undefined)).toBe(true);
  });

  it("starts the person's bubble below its place and rides the slot with it", () => {
    draw(true, 0);
    const mine = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);

    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(56px)");
    const rise = moved(mine)[0]?.keyframes[0]?.transform;
    expect(rise).toMatch(/^translateY\(\d+(\.\d+)?px\)$/);
    expect(moved(slot)[0]?.keyframes[0]?.transform).toBe(rise);
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
