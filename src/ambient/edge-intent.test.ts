import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { REVEAL, createEdgeIntent } from "./edge-intent";

let clock = 0;
let opened = 0;
let intent: ReturnType<typeof createEdgeIntent>;
const tick = (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); };
const away = (x = 100, y = 300) => intent.point({ x, y, inZone: false });
const edge = (y = 300, buttons = 0, x = 400) => intent.point({ x, y, inZone: true, buttons });

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  opened = 0;
  intent = createEdgeIntent(() => { opened += 1; }, () => clock);
});
afterEach(() => { intent.dispose(); vi.useRealTimers(); });

it("opens once the pointer has come to the edge and rested there", () => {
  away();
  tick(16);
  edge();
  tick(REVEAL.dwellMs - 20);
  expect(opened).toBe(0);
  tick(40);
  expect(opened).toBe(1);
});

it("a small jitter while resting still counts as resting", () => {
  away();
  edge(300);
  tick(200);
  edge(304);
  tick(REVEAL.dwellMs - 200 + 10);
  expect(opened).toBe(1);
});

it("brushing the edge and leaving opens nothing", () => {
  away();
  edge();
  tick(REVEAL.dwellMs / 2);
  away();
  tick(REVEAL.dwellMs * 3);
  expect(opened).toBe(0);
});

it("sliding along the edge opens nothing until the pointer stops", () => {
  away();
  for (let i = 0; i < 20; i += 1) { edge(100 + i * 30); tick(50); }
  expect(opened).toBe(0);
  tick(REVEAL.dwellMs);
  expect(opened).toBe(1);
});

it("never opens while a button is held, and waits for a fresh rest once it is let go", () => {
  away();
  edge(300, 1);
  tick(REVEAL.dwellMs * 3);
  edge(301, 1);
  tick(REVEAL.dwellMs * 3);
  expect(opened).toBe(0);
  edge(302, 0);
  tick(REVEAL.dwellMs - 20);
  expect(opened).toBe(0);
  tick(40);
  expect(opened).toBe(1);
});

it("a pointer that just appears at the edge (a window or space switch) has not headed there", () => {
  edge();
  tick(REVEAL.dwellMs * 3);
  edge(330);
  tick(REVEAL.dwellMs * 3);
  expect(opened).toBe(0);
  // stepping out and back in is a real arrival
  away();
  edge();
  tick(REVEAL.dwellMs + 10);
  expect(opened).toBe(1);
});

it("an arrival from long ago does not count either", () => {
  away();
  tick(REVEAL.arriveMs + 50);
  edge();
  tick(REVEAL.dwellMs * 2);
  expect(opened).toBe(0);
});

it("holds off right after a focus change, then a deliberate rest still works", () => {
  away();
  edge();
  tick(100);
  intent.quiet(clock);
  tick(REVEAL.dwellMs * 2);
  expect(opened).toBe(0);
  tick(REVEAL.quietMs);
  edge(340);
  tick(REVEAL.dwellMs + 10);
  expect(opened).toBe(1);
});

it("a click in the zone opens at once; outside it, a click does nothing", () => {
  intent.press();
  expect(opened).toBe(0);
  edge();
  intent.press();
  expect(opened).toBe(1);
  // the pending rest is dropped, so the column is not asked to open twice
  tick(REVEAL.dwellMs * 2);
  expect(opened).toBe(1);
});

it("reset drops a pending rest", () => {
  away();
  edge();
  tick(100);
  intent.reset();
  tick(REVEAL.dwellMs * 2);
  expect(opened).toBe(0);
});
