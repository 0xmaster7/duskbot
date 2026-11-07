// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// motion's animate is recorded too; its moves stay in flight until a test settles them
type Lifted = { el: Element; keyframes: Record<string, unknown[]>; options: Record<string, unknown> };
const lifted = vi.hoisted(() => ({ calls: [] as unknown[], settle: [] as (() => void)[] }));
vi.mock("motion/react", async (original) => ({
  ...await original<typeof import("motion/react")>(),
  animate: (el: Element, keyframes: Record<string, unknown[]>, options: Record<string, unknown>) => {
    lifted.calls.push({ el, keyframes, options });
    return { finished: new Promise<void>((resolve) => lifted.settle.push(resolve)) };
  },
}));
const lifts = (el: Element) => (lifted.calls as Lifted[]).filter((call) => call.el === el);

import { RISE_PX, settleTiming, useArrivalFlow } from "./use-arrival-flow";
import { SPRING_REPLY, SPRING_SEND } from "@/lib/motion-presets";

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
  lifted.calls = [];
  lifted.settle = [];
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

  it("puts a bot's reply on screen at once and lets it settle in softly while the status line fades", () => {
    draw(true, 0);
    // a 60px bubble lands above the slot
    const reply = addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(0);
    const [entrance] = lifts(reply);
    expect(entrance?.keyframes).toMatchObject({ transform: ["translateY(7px) scale(0.98)", "translateY(0px) scale(1)"], opacity: [0, 1] });
    expect(entrance?.options.transform).toBe(SPRING_REPLY);
    // its first frame is on the element before the browser paints
    expect(reply.style.transform).toBe("translateY(7px) scale(0.98)");
    const line = recorded.find((r) => r.el === slot);
    expect(line?.keyframes[1]?.opacity).toBe(0);
    expect(line?.keyframes.every((frame) => frame.transform === undefined)).toBe(true);
  });

  it("grows a reply out of the slot's typing bubble, with the view gliding up instead of jumping", () => {
    const dots = document.createElement("div");
    dots.dataset.replySlot = "dots";
    place(dots, 0, slot);
    Object.defineProperty(dots, "offsetLeft", { configurable: true, get: () => 0 });
    Object.defineProperties(dots, { offsetWidth: { value: 56 }, offsetHeight: { value: 36 } });
    slot.append(dots);
    draw(true, 0);

    // the typing bubble is gone in the frame the 200x58 reply lands where it was
    dots.remove();
    const reply = addRow(900, "start");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble-bot";
    bubble.append(document.createElement("p"));
    place(bubble, 0, reply);
    Object.defineProperty(bubble, "offsetLeft", { configurable: true, get: () => 0 });
    Object.defineProperty(reply, "offsetLeft", { configurable: true, get: () => 0 });
    Object.defineProperties(bubble, { offsetWidth: { value: 200 }, offsetHeight: { value: 58 } });
    reply.append(bubble);
    place(slot, 962, column);
    scrollHeight = 1062;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    const grow = recorded.find((r) => r.el === bubble);
    expect(grow?.keyframes[0]).toMatchObject({ transform: "translate(0px, 0px)", clipPath: "inset(0px 144px 22px 0px round 18px)" });
    expect(grow?.keyframes[1]?.clipPath).toBe("inset(0px 0px 0px 0px round 18px)");
    expect(recorded.find((r) => r.el === bubble.firstElementChild)?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(lifts(reply), "no second entrance on the row").toHaveLength(0);
    // the column starts where it was on screen and glides to its end
    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(62px)");
  });

  it("jumps the view to its end at once on a send and moves only the new bubble, from the composer, on a spring", () => {
    draw(true, 0);
    const mine = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    // the rows already there do not move: no transform on the column
    expect(moved(column)).toHaveLength(0);
    expect(clip.style.overflowY).toBe("clip");
    const [rise] = lifts(mine);
    const from = Number(/translateY\(([\d.]+)px\)/.exec(String(rise?.keyframes.transform?.[0]))?.[1]);
    expect(from).toBeGreaterThanOrEqual(RISE_PX[0]);
    expect(from).toBeLessThanOrEqual(RISE_PX[1]);
    expect(rise?.keyframes.opacity).toEqual([0, 1]);
    expect(rise?.options.transform).toBe(SPRING_SEND);
    // the slot rides under it on the same move
    expect(lifts(slot)[0]?.keyframes.transform).toEqual(rise?.keyframes.transform);
    // settled: the transform is handed back and the clip comes off
    act(() => lifted.settle.forEach((resolve) => resolve()));
    return Promise.resolve().then(() => {
      expect(mine.style.transform).toBe("");
      expect(clip.style.overflowY).toBe("");
    });
  });

  it("follows the composer settling under a bubble still rising, instead of jumping", () => {
    draw(true, 0);
    addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);
    // a long draft closes back to one row: the transcript's end pad shrinks by 40px while the bubble is still rising
    place(slot, 956, column);
    scrollHeight = 1016;
    scroller.scrollTop = scrollHeight - CLIENT;
    draw(true, 2);
    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(-40px)");
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
