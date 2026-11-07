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

import { ARRIVAL_CURVE, ARRIVAL_EASE, REVEAL_MS, revealTiming, SEND_MS, SEND_RISE_PX, settleTiming, useArrivalFlow } from "./use-arrival-flow";

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
    expect(entrance?.options.transform).toEqual({ duration: REVEAL_MS[0] / 1000, ease: ARRIVAL_CURVE });
    // its first frame is on the element before the browser paints
    expect(reply.style.transform).toBe("translateY(7px) scale(0.98)");
    const line = recorded.find((r) => r.el === slot);
    expect(line?.keyframes[1]?.opacity).toBe(0);
    expect(line?.keyframes.every((frame) => frame.transform === undefined)).toBe(true);
  });

  it("grows a reply out of the working line it replaces, with the view gliding up instead of jumping", () => {
    const presence = document.createElement("div");
    presence.className = "turn-presence";
    const line = document.createElement("div");
    presence.append(line);
    place(line, 0, slot);
    Object.defineProperty(line, "offsetLeft", { configurable: true, get: () => 0 });
    Object.defineProperties(line, { offsetWidth: { value: 56 }, offsetHeight: { value: 36 } });
    slot.append(presence);
    draw(true, 0);

    // the line is gone in the frame the 200x58 reply lands where it was
    presence.remove();
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
    expect(grow?.options).toMatchObject(revealTiming(58));
    // the words come in a beat behind the shape, so they never show squeezed into a box still opening
    const words = recorded.find((r) => r.el === bubble.firstElementChild);
    expect(words?.keyframes).toEqual([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0px)" }]);
    expect(words?.options).toMatchObject({ easing: ARRIVAL_EASE, fill: "backwards" });
    expect(Number(words?.options.delay)).toBeGreaterThan(0);
    expect(lifts(reply), "no second entrance on the row").toHaveLength(0);
    // the column starts where it was on screen and glides to its end, on the bubble's own curve and clock
    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(62px)");
    expect(moved(column)[0]?.options).toMatchObject(revealTiming(58));
  });

  it("opens a tall reply for longer than a short one, within its bounds, on one ease with no overshoot", () => {
    expect(revealTiming(36).duration).toBe(REVEAL_MS[0]);
    expect(revealTiming(20).duration).toBe(REVEAL_MS[0]);
    expect(revealTiming(300).duration).toBeGreaterThan(revealTiming(120).duration);
    expect(revealTiming(2000).duration).toBe(REVEAL_MS[1]);
    expect(revealTiming(300).easing).toBe(ARRIVAL_EASE);
    // an ease-out bezier whose control points stay inside 0..1 never overshoots
    expect(ARRIVAL_CURVE.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("puts the view at its end on a send and glides the column and the new bubble into place, never jumping", () => {
    draw(true, 0);
    const mine = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    // the rows already there start where they were on screen and glide up with the send
    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(56px)");
    expect(moved(column)[0]?.options).toMatchObject({ duration: SEND_MS, easing: ARRIVAL_EASE });
    expect(clip.style.overflowY).toBe("clip");
    const [rise] = lifts(mine);
    expect(rise?.keyframes.transform).toEqual([`translateY(${SEND_RISE_PX}px)`, "translateY(0px)"]);
    expect(rise?.keyframes.opacity).toEqual([0, 1]);
    expect(rise?.options.transform).toEqual({ duration: SEND_MS / 1000, ease: ARRIVAL_CURVE });
    // the slot rides under it on the same move
    expect(lifts(slot)[0]?.keyframes.transform).toEqual(rise?.keyframes.transform);
    // settled: the transform is handed back and the clip comes off
    act(() => {
      lifted.settle.forEach((resolve) => resolve());
      finishers.forEach((finish) => finish());
    });
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
    // on top of the send's own glide (56px, still at its start here), so the two read as one move
    expect(moved(column).at(-1)?.keyframes[0]?.transform).toBe("translateY(16px)");
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
