import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CHECK_MS, IDLE_AFTER_S, watchStill } from "./ambient-still.mjs";

function world({ focused = true } = {}) {
  const app = new EventEmitter(), powerMonitor = new EventEmitter();
  const at = { focused, idle: "active", asked: [] };
  powerMonitor.getSystemIdleState = (seconds) => { at.asked.push(seconds); return at.idle; };
  const timers = new Map();
  let next = 1;
  const told = [];
  const watcher = watchStill({
    app, powerMonitor, focused: () => at.focused, onChange: (still) => told.push(still),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    defer: (fn) => fn(),
  });
  const tickChecks = () => { for (const { fn } of [...timers.values()]) fn(); };
  return { app, powerMonitor, at, timers, told, watcher, tickChecks };
}

test("the surfaces hold still while the person is in another app, and move again when they come back", () => {
  const w = world();
  assert.deepEqual(w.told, [false]);
  w.at.focused = false;
  w.app.emit("browser-window-blur");
  assert.deepEqual(w.told, [false, true]);
  assert.equal(w.timers.size, 0, "nothing is polled while the app is in the background");
  w.at.focused = true;
  w.app.emit("browser-window-focus");
  assert.deepEqual(w.told, [false, true, false]);
  assert.equal([...w.timers.values()][0].ms, CHECK_MS);
  w.watcher.stop();
  assert.equal(w.timers.size, 0);
});

test("moving focus from one window of the app to another is not leaving it", () => {
  const w = world();
  w.app.emit("browser-window-blur");
  w.app.emit("browser-window-focus");
  assert.deepEqual(w.told, [false]);
});

test("a minute untouched, a locked screen or a sleeping Mac holds them still too", () => {
  const w = world();
  w.at.idle = "idle";
  w.tickChecks();
  assert.deepEqual(w.told, [false, true]);
  assert.equal(w.at.asked.at(-1), IDLE_AFTER_S);
  w.at.idle = "active";
  w.tickChecks();
  w.powerMonitor.emit("lock-screen");
  assert.equal(w.timers.size, 0);
  w.powerMonitor.emit("unlock-screen");
  w.powerMonitor.emit("suspend");
  w.powerMonitor.emit("resume");
  assert.deepEqual(w.told, [false, true, false, true, false, true, false]);
});

test("the app starting in the background starts still", () => {
  assert.deepEqual(world({ focused: false }).told, [true]);
});
