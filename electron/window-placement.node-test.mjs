import assert from "node:assert/strict";
import test from "node:test";

import { createWindowPlacement, workAreasOf } from "./window-placement.mjs";

const primary = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const external = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1055 } };

function fakeScreen(displays) {
  const listeners = {};
  return {
    displays,
    listeners,
    getPrimaryDisplay: () => displays[0],
    getAllDisplays: () => [...displays].reverse(),
    on: (name, listener) => { listeners[name] = listener; },
  };
}
function fakeWindow(bounds, { minimum = [768, 520], maximized = false, fullScreen = false, destroyed = false } = {}) {
  const win = {
    bounds,
    isDestroyed: () => destroyed,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen,
    getBounds: () => win.bounds,
    getMinimumSize: () => minimum,
    setBounds: (next) => { win.bounds = next; },
  };
  return win;
}
const manual = () => {
  const pending = [];
  return { pending, schedule: (fn) => { pending.push(fn); return pending.length; }, cancel: () => { pending.length = 0; }, run: () => pending.splice(0).forEach((fn) => fn()) };
};

test("work areas list the primary display first", () => {
  assert.deepEqual(workAreasOf(fakeScreen([primary, external])), [primary.workArea, external.workArea]);
});

test("a window opened partly past the left edge is pulled whole onto the display", () => {
  const screen = fakeScreen([primary]);
  const win = fakeWindow({ x: -320, y: 60, width: 1040, height: 760 });
  const placement = createWindowPlacement({ screen, windows: () => [win] });
  assert.equal(placement.fit(win), true);
  assert.deepEqual(win.bounds, { x: 0, y: 60, width: 1040, height: 760 });
  assert.equal(placement.fit(win), false, "a window already whole is left where it is");
});

test("a small fixed window keeps its size: only the main window has a minimum", () => {
  const screen = fakeScreen([primary]);
  const card = fakeWindow({ x: 1300, y: 800, width: 360, height: 300 }, { minimum: [0, 0] });
  createWindowPlacement({ screen, windows: () => [card] }).fit(card);
  assert.deepEqual(card.bounds, { x: 1080, y: 600, width: 360, height: 300 });
});

test("maximized, full-screen and closed windows are left to the system", () => {
  const screen = fakeScreen([primary]);
  const placement = createWindowPlacement({ screen, windows: () => [] });
  for (const options of [{ maximized: true }, { fullScreen: true }, { destroyed: true }]) {
    const win = fakeWindow({ x: -500, y: 0, width: 1040, height: 760 }, options);
    assert.equal(placement.fit(win), false);
    assert.equal(win.bounds.x, -500);
  }
});

test("unplugging the display a window was on brings it onto the one left, once the system settles", () => {
  const screen = fakeScreen([primary, external]);
  const win = fakeWindow({ x: -1500, y: 100, width: 1200, height: 800 });
  const clock = manual();
  const placement = createWindowPlacement({ screen, windows: () => [win], schedule: clock.schedule, cancel: clock.cancel });
  placement.install();
  assert.deepEqual(Object.keys(screen.listeners).sort(), ["display-added", "display-metrics-changed", "display-removed"]);
  screen.displays.splice(1);
  screen.listeners["display-removed"]();
  screen.listeners["display-metrics-changed"]();
  assert.equal(clock.pending.length, 1, "one pass for a burst of changes");
  assert.equal(win.bounds.x, -1500, "nothing moves before the system settles");
  clock.run();
  assert.deepEqual(win.bounds, { x: 120, y: 63, width: 1200, height: 800 });
});
