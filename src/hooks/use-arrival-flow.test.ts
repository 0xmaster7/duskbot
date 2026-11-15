// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { FOLLOW, makeTurnRoom, OWN_ENTRANCE, releaseRoomOutOfView, ROW_ENTER_EASE, ROW_ENTER_MS, ROW_RISE_PX, rowEnter, springTiming, useArrivalFlow, type TurnRoom } from "./use-arrival-flow";

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
let room: TurnRoom = { held: false };
const CLIENT = 600;

function Probe({ following, n, thread = "t" }: { following: boolean; n: number; thread?: string }) {
  useArrivalFlow({ scrollRef: { current: scroller }, clipRef: { current: clip }, columnRef: { current: column }, transcriptKey: thread, following, room: { current: room } });
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
  room = { held: false };
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

  it("puts a bot's reply on screen whole: the view is at its end at once and the column glides up by what it added", () => {
    draw(true, 0);
    const before = scroller.scrollTop;
    const reply = addRow(900, "start");
    place(slot, 960, column);
    scrollHeight = 1060;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    // the rows already on screen start where they were drawn, 60px lower, and glide into place: no one-frame jump
    const [glide] = moved(column);
    expect(glide?.keyframes).toEqual([{ transform: `translateY(${scroller.scrollTop - before}px)` }, { transform: "translateY(0px)" }]);
    expect(glide?.options).toEqual({ duration: FOLLOW.duration, easing: FOLLOW.easing });
    // the reply rides the column: no rise, fade or clip reveal of its own, and the status line is left alone
    expect(rises(reply)).toHaveLength(0);
    expect(glide?.keyframes.every((frame) => frame.opacity === undefined && frame.clipPath === undefined)).toBe(true);
    expect(rises(slot)).toHaveLength(0);
  });

  it("gives the person's own bubble the same glide, and clips the column only while it moves", () => {
    draw(true, 0);
    const mine = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);

    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)[0]?.keyframes[0]?.transform).toBe("translateY(56px)");
    expect(rises(mine)).toHaveLength(0);
    expect(clip.style.overflowY).toBe("clip");
    act(() => finishers.forEach((finish) => finish()));
    expect(clip.style.overflowY).toBe("");
  });

  it("moves a batch of rows as one column, with no stagger", () => {
    draw(true, 0);
    const file = addRow(900, "start");
    const summary = addRow(970, "start");
    place(slot, 1040, column);
    scrollHeight = 1140;
    draw(true, 1);
    expect(moved(column)).toHaveLength(1);
    expect(rises(file)).toHaveLength(0);
    expect(rises(summary)).toHaveLength(0);
  });

  it("lets a row rise 12px into place when there was room for it and nothing on screen moves", () => {
    scrollHeight = CLIENT;
    scroller.scrollTop = 0;
    draw(true, 0);
    const reply = addRow(300, "start");
    draw(true, 1);
    expect(moved(column)).toHaveLength(0);
    const [entrance] = rises(reply);
    expect(entrance?.keyframes).toEqual([{ transform: `translateY(${ROW_RISE_PX}px)` }, { transform: "translateY(0px)" }]);
    expect(entrance?.options).toEqual({ duration: ROW_ENTER_MS, easing: ROW_ENTER_EASE });
    expect(rowEnter).toBeTypeOf("function");
  });

  it("lets a row that plays its own entrance land with no rise, when there was room for it", () => {
    scrollHeight = CLIENT;
    scroller.scrollTop = 0;
    draw(true, 0);
    const reply = addRow(300, "start");
    reply.setAttribute(OWN_ENTRANCE, "");
    draw(true, 1);
    expect(recorded).toHaveLength(0);
  });

  it("never re-animates the rows that were already there when the next one lands", () => {
    draw(true, 0);
    const sent = addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);
    const reply = addRow(956, "start");
    place(slot, 1040, column);
    scrollHeight = 1140;
    draw(true, 2);
    // the person's bubble (its optimistic copy's node, kept when the server's copy replaces it) is never animated alone
    expect(rises(sent)).toHaveLength(0);
    expect(rises(reply)).toHaveLength(0);
    expect(moved(column)).toHaveLength(2);
  });

  it("keeps the end pinned in the frame the composer changes height, with no glide", () => {
    draw(true, 0);
    addRow(900, "end");
    place(slot, 956, column);
    scrollHeight = 1056;
    draw(true, 1);
    const glides = moved(column).length;
    // the composer's pad grows by 40px under a transcript resting at its end
    scrollHeight = 1096;
    draw(true, 2);
    expect(scroller.scrollTop).toBe(scrollHeight - CLIENT);
    expect(moved(column)).toHaveLength(glides);
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

describe("the follow spring", () => {
  const curve = (timing: { easing: string }) => /linear\(([^)]+)\)/.exec(timing.easing)![1]!.split(",").map(Number);

  it("runs from rest to rest with no bounce, most of the way there by 0.3s", () => {
    const points = curve(FOLLOW);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(points.every((value, i) => i === 0 || value >= points[i - 1]!)).toBe(true);
    const at300 = points[Math.round((300 / FOLLOW.duration) * (points.length - 1))]!;
    expect(at300).toBeGreaterThan(0.94);
    expect(FOLLOW.duration).toBeLessThan(700);
  });

  it("lets an underdamped spring settle past its end and back", () => {
    const points = curve(springTiming(420, 32));
    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(points.at(-1)).toBe(1);
  });
});

describe("the turn's room", () => {
  const rect = (top: number, height = 34) => () => ({ top, height, left: 0, right: 0, bottom: top + height, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  let scroller: HTMLDivElement, column: HTMLDivElement;
  beforeEach(() => {
    scroller = document.createElement("div");
    column = document.createElement("div");
    scroller.append(column);
    document.body.append(scroller);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 600 });
    // the column is 1000px of rows, or its min-height when that is more; the scroller adds nothing around it
    Object.defineProperty(column, "offsetHeight", { configurable: true, get: () => Math.max(1000, parseFloat(column.style.minHeight) || 0) });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => column.offsetHeight });
    scroller.getBoundingClientRect = rect(0, 600);
  });
  afterEach(() => scroller.remove());

  it("keeps the column tall enough that, at its end, the sent message sits just under the header", () => {
    scroller.scrollTop = 400;
    const sent = document.createElement("div");
    // the send is laid out 500px down the view: 900px into the transcript
    sent.getBoundingClientRect = rect(500);
    expect(makeTurnRoom(scroller, column, sent)).toBe(true);
    // its end at 1484 - 600 = 884 puts the row at 900 - 884 = 16px under the top
    expect(column.style.minHeight).toBe("1484px");
  });

  it("makes the next send's room with the last turn's room still in place, so the scroll position is never clamped under it", () => {
    column.style.minHeight = "1484px";
    scroller.scrollTop = 884;
    const sent = document.createElement("div");
    // 1300px into the transcript, 416px down the view
    sent.getBoundingClientRect = rect(416);
    expect(makeTurnRoom(scroller, column, sent)).toBe(true);
    expect(column.style.minHeight).toBe("1884px");
    expect(scroller.scrollTop).toBe(884);
  });

  it("makes no room for a send that is already near the top", () => {
    scroller.scrollTop = 400;
    const sent = document.createElement("div");
    sent.getBoundingClientRect = rect(10);
    expect(makeTurnRoom(scroller, column, sent)).toBe(false);
    expect(column.style.minHeight).toBe("");
  });

  it("lets the room go only once its empty part is out of view, so nothing on screen moves", () => {
    column.style.minHeight = "1484px";
    scroller.scrollTop = 884;
    releaseRoomOutOfView(scroller, column);
    expect(column.style.minHeight, "the empty part is on screen").toBe("1484px");
    scroller.scrollTop = 400;
    releaseRoomOutOfView(scroller, column);
    expect(column.style.minHeight, "scrolled up past it").toBe("");
  });
});

it("holds the view still while the turn fills its room: no pin, no glide, the reply lands where it shows", () => {
  draw(true, 0);
  room.held = true;
  const top = scroller.scrollTop;
  const reply = addRow(900, "start");
  reply.setAttribute(OWN_ENTRANCE, "");
  // a reply taller than the room runs on below the view
  scrollHeight = 1200;
  draw(true, 1);
  expect(scroller.scrollTop).toBe(top);
  expect(moved(column)).toHaveLength(0);
  expect(recorded.filter((r) => r.el === reply)).toHaveLength(0);
});

it("makes a send's room from wherever the view is when a long reply runs on below it, and slides once from there", () => {
  // the last reply ran on below the view, which held still for it: the view is 200px down, not at its end
  room.held = true;
  scroller.scrollTop = 200;
  draw(true, 0);
  const sent = addRow(1000, "end");
  sent.getBoundingClientRect = () => ({ top: 500, height: 34, bottom: 534, left: 0, right: 0, width: 0, x: 0, y: 500, toJSON: () => ({}) }) as DOMRect;
  // the room is the only thing that changes the height here; the column has no layout of its own in this stand-in
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 1000 + (parseFloat(column.style.minHeight) || 0) });
  draw(true, 1);
  // 200 + (500 - 16) - (1000 - 600) = 284px of room puts the send 16px under the top at the new end
  expect(column.style.minHeight).toBe("284px");
  expect(scroller.scrollTop).toBe(684);
  expect(room.held).toBe(true);
  expect(moved(column).map((r) => r.keyframes[0]?.transform)).toEqual(["translateY(484px)"]);
});
